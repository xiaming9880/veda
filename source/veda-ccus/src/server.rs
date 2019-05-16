use actix::prelude::*;
use rand::{self, rngs::ThreadRng, Rng};
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use v_onto::individual::*;
use v_onto::msgpack8individual::msgpack2individual;
use v_queue::*;

/// CCUS server sends this messages to session
#[derive(Message)]
pub struct Message(pub String);

/// Message for CCUS server communications

/// New ccus session is created
#[derive(Message)]
#[rtype(usize)]
pub struct Connect {
    pub addr: Recipient<Message>,
}

/// Session is disconnected
#[derive(Message)]
pub struct Disconnect {
    pub id: usize,
}

#[derive(Message)]
pub struct ClientMessage {
    /// Id of the client session
    pub id: usize,
    /// Peer message
    pub msg: String,
}

pub struct CCUSServer {
    sessions: HashMap<usize, Recipient<Message>>,
    uri2sessions: HashMap<String, HashSet<usize>>,
    queue_consumer: Consumer,
    total_prepared_count: u64,
    rng: ThreadRng,
    stat_sessions: usize,
    stat_uris: usize,
}

const QUEUE_CHECK_INTERVAL: Duration = Duration::from_millis(500);

impl Default for CCUSServer {
    fn default() -> CCUSServer {
        let _consumer = Consumer::new("CCUS1", "individuals-flow").expect("!!!!!!!!! FAIL QUEUE");

        CCUSServer {
            sessions: HashMap::new(),
            uri2sessions: HashMap::new(),
            rng: rand::thread_rng(),
            queue_consumer: _consumer,
            total_prepared_count: 0,
            stat_sessions: 0,
            stat_uris: 0,
        }
    }
}

impl CCUSServer {
    fn unsubscribe_all(&mut self, session_id: usize) {
        let mut empty_uris: Vec<String> = Vec::new();

        for (uri, uss) in &mut self.uri2sessions {
            if uss.contains(&session_id) {
                uss.remove(&session_id);
                debug!("[{}]: REMOVE FROM URI={}, {}", session_id, uri, uss.len());
            }

            if uss.len() == 0 {
                empty_uris.push(uri.to_owned());
            }
        }

        for uri in empty_uris {
            self.uri2sessions.remove(&uri);
            debug!("[{}]: REMOVE URI={}", session_id, uri);
        }
    }

    fn subscribe(&mut self, uri: &str, counter: u64, session_id: usize) {
        let sessions = self.uri2sessions.entry(uri.to_owned()).or_default();

        if sessions.contains(&session_id) == false {
            sessions.insert(session_id);
            debug!("[{}]: SUBSCRIBE: uri={}, counter={}, count subscribers={}", session_id, uri, counter, sessions.len());
        } else {
            debug!("[{}]: SUBSCRIBE (ALREADY EXISTS): uri={}, count subscribers={}", session_id, uri, sessions.len());
        }
    }

    fn unsubscribe(&mut self, uri: &str, session_id: usize) {
        let mut empty_uris: Vec<String> = Vec::new();

        let uss = self.uri2sessions.entry(uri.to_owned()).or_default();

        if uss.contains(&session_id) {
            uss.remove(&session_id);
            debug!("[{}]: REMOVE FROM URI={}, {}", session_id, &uri, uss.len());
        }

        if uss.len() == 0 {
            empty_uris.push(uri.to_owned());
        }

        for uri in empty_uris {
            self.uri2sessions.remove(&uri);
            debug!("[{}]: REMOVE URI={}", session_id, uri);
        }
    }

    fn prepare_command(&mut self, message: &str, session_id: usize) {
        for item in message.split(',') {
            let els: Vec<&str> = item.split('=').collect();

            if els.len() == 2 {
                if els[0] == "ccus" {
                    // Рукопожатие: ccus=Ticket
                    debug!("[{}]: HANDSHAKE", session_id);
                    break;
                } else {
                    if let Some(uri) = els[0].get(1..) {
                        let mut counter = 0;
                        if let Ok(c) = els[1].parse() {
                            counter = c;
                        };

                        // Добавить подписку: +uriN=M[,...]
                        self.subscribe(uri, counter, session_id);
                    }
                }
            } else if els.len() == 1 {
                if let Some(uri) = els[0].get(1..) {
                    if uri == "*" {
                        // Отменить все подписки: -*
                        self.unsubscribe_all(session_id);
                    } else {
                        // Отменить подписку: -uriN[,...]
                        self.unsubscribe(uri, session_id);
                    }
                }
            }
        }
    }
}

/// Make actor from `CCUSServer`
impl Actor for CCUSServer {
    /// We are going to use simple Context, we just need ability to communicate with other actors.
    type Context = Context<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        info!("Start CCUS");

        ctx.run_interval(QUEUE_CHECK_INTERVAL * 10, |act, _ctx| {
            if act.sessions.len() != act.stat_sessions || act.uri2sessions.len() != act.stat_uris {
                info!("STAT: count subscribers: {}, look uris: {}", act.sessions.len(), act.uri2sessions.len());

                act.stat_sessions = act.sessions.len();
                act.stat_uris = act.uri2sessions.len();
            }
        });

        ctx.run_interval(QUEUE_CHECK_INTERVAL, |act, _ctx| {
            // READ QUEUE

            let mut size_batch = 0;

            // read queue current part info
            if let Err(e) = act.queue_consumer.queue.get_info_of_part(act.queue_consumer.id, true) {
                error!("{} get_info_of_part {}: {}", act.total_prepared_count, act.queue_consumer.id, e.as_str());
                return;
            }

            if act.queue_consumer.queue.count_pushed - act.queue_consumer.count_popped == 0 {
                // if not new messages, read queue info
                act.queue_consumer.queue.get_info_queue();

                if act.queue_consumer.queue.id > act.queue_consumer.id {
                    size_batch = 1;
                }
            } else if act.queue_consumer.queue.count_pushed - act.queue_consumer.count_popped > 0 {
                if act.queue_consumer.queue.id != act.queue_consumer.id {
                    size_batch = 1;
                } else {
                    size_batch = act.queue_consumer.queue.count_pushed - act.queue_consumer.count_popped;
                }
            }

            if size_batch > 0 {
                info!("queue: batch size={}", size_batch);
            }

            let mut session2uris: HashMap<usize, HashMap<String, u64>> = HashMap::new();

            for _it in 0..size_batch {
                // пробуем взять из очереди заголовок сообщения
                if act.queue_consumer.pop_header() == false {
                    break;
                }

                let mut msg = Individual::new(vec![0; (act.queue_consumer.header.msg_length) as usize]);

                // заголовок взят успешно, занесем содержимое сообщения в структуру Individual
                if let Err(e) = act.queue_consumer.pop_body(&mut msg.binobj) {
                    if e == ErrorQueue::FailReadTailMessage {
                        break;
                    } else {
                        error!("{} get msg from queue: {}", act.total_prepared_count, e.as_str());
                        break;
                    }
                }

                // запустим ленивый парсинг сообщения в Indidual
                if msgpack2individual(&mut msg) == false {
                    error!("{}: fail parse, retry", act.total_prepared_count);
                    break;
                }

                // берем поле [uri]
                if let Ok(uri_from_queue) = msg.get_first_literal("uri") {
                    // найдем есть ли среди uri на которые есть подписки, uri из очереди
                    if let Some(sessions) = act.uri2sessions.get_mut(&uri_from_queue) {
                        debug!("FOUND CHANGES: uri={}, sessions={:?}", uri_from_queue, sessions);

                        // берем u_counter
                        let counter_from_queue = msg.get_first_integer("u_count") as u64;
                        debug!("uri={}, {}", uri_from_queue, counter_from_queue);

                        for session in sessions.iter() {
                            let urics = session2uris.entry(*session).or_default();
                            urics.insert(uri_from_queue.clone(), counter_from_queue);
                        }
                    }
                }

                act.queue_consumer.commit_and_next();

                act.total_prepared_count += 1;

                if act.total_prepared_count % 1000 == 0 {
                    info!("get from queue, count: {}", act.total_prepared_count);
                }
            }

            for el in session2uris.iter() {
                let mut changes = String::new();

                for (uri, counter) in el.1.iter() {
                    if changes.len() > 0 {
                        changes.push_str(",");
                    }

                    changes.push_str(&uri.to_owned());
                    changes.push_str("=");
                    changes.push_str(&counter.to_string());
                }

                if let Some(addr) = act.sessions.get(el.0) {
                    let _ = addr.do_send(Message(changes.to_owned()));
                    debug!("send {}", changes);
                }
            }
        });
    }
}

/// Handler for Connect message. Register new session and assign unique id to this session
impl Handler<Connect> for CCUSServer {
    type Result = usize;

    fn handle(&mut self, msg: Connect, _: &mut Context<Self>) -> Self::Result {
        // register session with random id

        let id = self.rng.gen::<usize>();
        self.sessions.insert(id, msg.addr);

        info!("[{}] Registred", id);

        // send id back
        id
    }
}

/// Handler for Disconnect message.
impl Handler<Disconnect> for CCUSServer {
    type Result = ();

    fn handle(&mut self, msg: Disconnect, _: &mut Context<Self>) {
        // remove address
        if self.sessions.remove(&msg.id).is_some() {
            info!("[{}] Unregistred", &msg.id);
            self.unsubscribe_all(msg.id);
        }
    }
}

/// Handler for Message message.
impl Handler<ClientMessage> for CCUSServer {
    type Result = ();

    fn handle(&mut self, msg: ClientMessage, _: &mut Context<Self>) {
        self.prepare_command(msg.msg.as_str(), msg.id);
    }
}