use std::fs::*;
use std::io::prelude::*;
use std::io::SeekFrom;
use std::io::{BufRead, BufReader};
use std::mem::size_of;
use std::path::*;

extern crate fs2;
use crate::fs2::FileExt;

extern crate crc32fast;
use crc32fast::Hasher;

#[macro_use]
extern crate scan_fmt;

#[macro_use]
extern crate log;

pub const QUEUE_PATH: &str = "./data/queue";
pub const HEADER_SIZE: usize = 25;

#[derive(PartialEq, Debug)]
pub enum ErrorQueue {
    NotReady = -911,
    AlreadyOpen = -8,
    FailWrite = -7,
    InvalidChecksum = -6,
    FailReadTailMessage = -5,
    FailOpen = -4,
    FailRead = -3,
    NotFound = -2,
    Other = -1,
}

#[derive(PartialEq, Copy, Clone)]
pub enum Mode {
    Read = 0,
    ReadWrite = 1,
    Default = 2,
}

#[derive(PartialEq, Debug)]
#[repr(u8)]
pub enum MsgType {
    String = b'S',
    Object = b'O',
}

impl From<u8> for MsgType {
    fn from(t: u8) -> Self {
        if t == b'O' {
            return MsgType::Object;
        } else {
            return MsgType::String;
        }
    }
}

impl MsgType {
    fn as_u8(&self) -> u8 {
        if *self == MsgType::Object {
            return b'O';
        } else {
            return b'S';
        }
    }
}

impl ErrorQueue {
    pub fn as_str(&self) -> &'static str {
        match *self {
            ErrorQueue::NotFound => "not found",
            ErrorQueue::Other => "other error",
            ErrorQueue::AlreadyOpen => "already open",
            ErrorQueue::FailOpen => "fail open",
            ErrorQueue::FailRead => "fail read",
            ErrorQueue::FailWrite => "fail write",
            ErrorQueue::NotReady => "not ready",
            ErrorQueue::FailReadTailMessage => "fail read tail message",
            ErrorQueue::InvalidChecksum => "invalid checksum",
        }
    }
}

#[derive(Debug)]
pub struct Header {
    start_pos: u64,
    pub msg_length: u32,
    magic_marker: u32,
    count_pushed: u32,
    crc: u32,
    msg_type: MsgType,
}

impl Header {
    pub fn create_from_buf(buf: &Vec<u8>) -> Self {
        Header {
            start_pos: u64::from_ne_bytes([buf[0], buf[1], buf[2], buf[3], buf[4], buf[5], buf[6], buf[7]]),
            msg_length: u32::from_ne_bytes([buf[8], buf[9], buf[10], buf[11]]),
            magic_marker: u32::from_ne_bytes([buf[12], buf[13], buf[14], buf[15]]),
            count_pushed: u32::from_ne_bytes([buf[16], buf[17], buf[18], buf[19]]),
            msg_type: MsgType::from(buf[20]),
            crc: u32::from_ne_bytes([buf[21], buf[22], buf[23], buf[24]]),
        }
    }

    pub fn to_buf(&self, buf: &mut [u8; HEADER_SIZE]) {
        let mut l = 0;
        let mut r = size_of::<u64>();
        buf[l..r].clone_from_slice(&u64::to_ne_bytes(self.start_pos));
        l = r;
        r = r + size_of::<u32>();
        buf[l..r].clone_from_slice(&u32::to_ne_bytes(self.msg_length));
        l = r;
        r = r + size_of::<u32>();
        buf[l..r].clone_from_slice(&[0xEE, 0xFE, 0xEF, 0xEE]);
        l = r;
        r = r + size_of::<u32>();
        buf[l..r].clone_from_slice(&u32::to_ne_bytes(self.count_pushed));
        buf[r] = self.msg_type.as_u8();
        buf[r + 1] = 0;
        buf[r + 2] = 0;
        buf[r + 3] = 0;
        buf[r + 4] = 0;
    }
}

pub struct Consumer {
    is_ready: bool,
    name: String,
    pub queue: Queue,
    ff_info_pop_w: File,
    pub count_popped: u32,
    pos_record: u64,
    pub id: u32,

    // tmp
    pub header: Header,
    hash: Hasher,
}

impl Consumer {
    pub fn new(consumer_name: &str, queue_name: &str) -> Result<Consumer, ErrorQueue> {
        match Queue::new(queue_name, Mode::Read) {
            Ok(q) => match OpenOptions::new().read(true).write(true).create(true).open(QUEUE_PATH.to_owned() + "/" + queue_name + "_info_pop_" + consumer_name) {
                Ok(ff) => Ok({
                    let mut consumer = Consumer {
                        is_ready: true,
                        name: consumer_name.to_owned(),
                        ff_info_pop_w: ff,
                        queue: q,
                        count_popped: 0,
                        pos_record: 0,
                        hash: Hasher::new(),
                        header: Header {
                            start_pos: 0,
                            msg_length: 0,
                            magic_marker: 0,
                            count_pushed: 0,
                            crc: 0,
                            msg_type: MsgType::String,
                        },
                        id: 0,
                    };

                    if consumer.get_info() == true {
                        if let Ok(_) = consumer.queue.open_part(consumer.id) {
                            &consumer.queue.ff_queue.seek(SeekFrom::Start(consumer.pos_record));
                        } else {
                            consumer.queue.is_ready = true;
                            consumer.id = consumer.queue.id;
                            if let Ok(_) = consumer.queue.open_part(consumer.id) {
                                &consumer.queue.ff_queue.seek(SeekFrom::Start(consumer.pos_record));
                            } else {
                                return Err(ErrorQueue::NotReady);
                            }
                        }
                    } else {
                        return Err(ErrorQueue::NotReady);
                    }

                    consumer
                }),
                Err(_e) => Err(ErrorQueue::NotReady),
            },
            Err(_e) => Err(ErrorQueue::NotReady),
        }
    }

    pub fn open(&mut self, is_new: bool) -> bool {
        if self.queue.is_ready == false {
            error!("Consumer open: queue not ready, set consumer.ready = false");
            self.is_ready = false;
            return false;
        }

        let info_pop_file_name = QUEUE_PATH.to_owned() + "/" + &self.queue.name + "_info_pop_" + &self.name;

        if let Ok(ff) = OpenOptions::new().read(true).write(true).truncate(true).create(is_new).open(&info_pop_file_name) {
            self.ff_info_pop_w = ff;
        } else {
            error!("Consumer open: fail open file [{}], set consumer.ready = false", info_pop_file_name);
            self.is_ready = false;
            return false;
        }
        return true;
    }

    pub fn get_info(&mut self) -> bool {
        let mut res = true;

        &self.ff_info_pop_w.seek(SeekFrom::Start(0));
        for line in BufReader::new(&self.ff_info_pop_w).lines() {
            if let Ok(ll) = line {
                let (queue_name, consumer_name, position, count_popped, id) = scan_fmt!(&ll.to_owned(), "{};{};{};{};{}", String, String, u64, u32, u32);

                if let Some(q) = queue_name {
                    if q != self.queue.name {
                        res = false;
                    }
                } else {
                    res = false;
                }

                match consumer_name {
                    Some(q) => {
                        if q != self.name {
                            res = false;
                        }
                    }
                    None => res = false,
                }

                match position {
                    Some(pos) => {
                        // if pos > self.queue.right_edge {
                        //   res = false;
                        //  } else {
                        self.pos_record = pos;
                        //  }
                    }
                    None => res = false,
                }

                match count_popped {
                    Some(cc) => {
                        //  if cc > self.queue.count_pushed {
                        //      res = false;
                        //  } else {
                        self.count_popped = cc;
                        //  }
                    }
                    None => res = false,
                }

                match id {
                    Some(cc) => self.id = cc,
                    None => res = false,
                }
            } else {
                res = false;
                return res;
            }

            break;
        }

        info!("consumer ({}): count_pushed:{}, position:{}, id:{}, success:{}", self.name, self.count_popped, self.pos_record, self.id, res);
        return res;
    }

    pub fn pop_header(&mut self) -> bool {
        if self.count_popped >= self.queue.count_pushed {
            if let Err(e) = self.queue.get_info_of_part(self.id, false) {
                error!("{}, queue:consumer({}):pop, queue {}{} not ready", e.as_str(), self.name, self.queue.name, self.id);
                return false;
            }
        }

        if self.count_popped >= self.queue.count_pushed {
            //info!("@end of part {}, queue.id={}", self.id, self.queue.id);

            if self.queue.id == self.id {
                self.queue.get_info_queue();
            }

            if self.queue.id > self.id {
                while self.id < self.queue.id {
                    self.id = self.id + 1;

                    debug!("prepare next part {}", self.id);

                    if let Err(e) = self.queue.get_info_of_part(self.id, false) {
                        if e == ErrorQueue::NotFound {
                            warn!("queue:consumer({}):pop, queue {}:{} {}", self.name, self.queue.name, self.id, e.as_str());
                        } else {
                            error!("queue:consumer({}):pop, queue {}:{} {}", self.name, self.queue.name, self.id, e.as_str());
                            return false;
                        }
                    }
                }

                self.count_popped = 0;
                self.pos_record = 0;

                self.open(true);
                self.put_info();

                if let Err(e) = self.queue.open_part(self.id) {
                    error!("queue:consumer({}):pop, queue {}:{}, open part: {}", self.name, self.queue.name, self.id, e.as_str());
                }
            }
        }
        //self.queue.ff_queue.seek(SeekFrom::Start(self.pos_record));

        let mut buf = vec![0; HEADER_SIZE];
        match self.queue.ff_queue.read(&mut buf[..]) {
            Ok(len) => {
                //println!("@len={}, id={}", len, self.id);
                if len < HEADER_SIZE {
                    //self.is_ready = false;
                    //error!("fail read message header: len={}", len);
                    return false;
                }
            }
            Err(_) => {
                error!("fail read message header");
                //self.is_ready = false;
                return false;
            }
        }

        let header = Header::create_from_buf(&buf);

        buf[21] = 0;
        buf[22] = 0;
        buf[23] = 0;
        buf[24] = 0;

        self.hash = Hasher::new();
        self.hash.update(&buf[..]);

        self.header = header;
        return true;
    }

    pub fn pop_body(&mut self, msg: &mut [u8]) -> Result<usize, ErrorQueue> {
        if self.is_ready == false {
            return Err(ErrorQueue::NotReady);
        }

        if let Ok(readed_size) = self.queue.ff_queue.read(msg) {
            if readed_size != msg.len() {
                if self.count_popped == self.queue.count_pushed {
                    warn!("Detected problem with 'Read Tail Message': size fail");

                    if let Ok(_) = self.queue.ff_queue.seek(SeekFrom::Start(self.pos_record)) {
                        return Err(ErrorQueue::FailReadTailMessage);
                    }
                }
                return Err(ErrorQueue::FailRead);
            }

            //debug!("msg={:?}", msg);

            self.pos_record = self.pos_record + HEADER_SIZE as u64 + readed_size as u64;
            self.hash.update(msg);

            let crc32: u32 = self.hash.clone().finalize();

            if crc32 != self.header.crc {
                if self.count_popped == self.queue.count_pushed {
                    warn!("Detected problem with 'Read Tail Message': CRC fail");

                    if let Ok(_) = self.queue.ff_queue.seek(SeekFrom::Start(self.pos_record)) {
                        return Err(ErrorQueue::FailReadTailMessage);
                    }
                }

                error!("CRC fail, set consumer.ready = false");
                self.is_ready = false;
                return Err(ErrorQueue::InvalidChecksum);
            }
            return Ok(readed_size);
        } else {
            return Err(ErrorQueue::FailRead);
        }
    }

    pub fn put_info(&mut self) {
        if let Ok(_) = self.ff_info_pop_w.seek(SeekFrom::Start(0)) {
        } else {
            error!("fail put info, set consumer.ready = false");
            self.is_ready = false;
        }
        if let Ok(_) = self.ff_info_pop_w.write(format!("{};{};{};{};{}\n", self.queue.name, self.name, self.pos_record, self.count_popped, self.id).as_bytes()) {
        } else {
            error!("fail put info, set consumer.ready = false");
            self.is_ready = false;
        }
    }

    pub fn commit_and_next(&mut self) -> bool {
        if self.is_ready == false {
            error!("commit");
            return false;
        }

        self.count_popped = self.count_popped + 1;
        if let Ok(_) = self.ff_info_pop_w.seek(SeekFrom::Start(0)) {
        } else {
            return false;
        }

        if let Ok(_) = self.ff_info_pop_w.write(format!("{};{};{};{};{}\n", self.queue.name, self.name, self.pos_record, self.count_popped, self.id).as_bytes()) {
            return true;
        };

        return false;
    }
}

pub struct Queue {
    mode: Mode,
    is_ready: bool,
    name: String,
    ff_queue: File,
    ff_info_push: File,
    ff_info_queue: File,
    right_edge: u64,
    pub count_pushed: u32,
    pub id: u32,
}

impl Queue {
    pub fn new(queue_name: &str, mode: Mode) -> Result<Queue, ErrorQueue> {
        let file_name_info_queue = QUEUE_PATH.to_owned() + "/" + queue_name + "_info_queue";

        if let Ok(fqi) = OpenOptions::new().read(true).write(true).create(true).open(file_name_info_queue) {
            let tmp_f1 = fqi.try_clone().unwrap();
            let tmp_f2 = fqi.try_clone().unwrap();

            let mut queue = Queue {
                mode: mode.clone(),
                is_ready: true,
                name: queue_name.to_owned(),
                count_pushed: 0,
                right_edge: 0,
                ff_queue: fqi,
                ff_info_queue: tmp_f1,
                ff_info_push: tmp_f2,
                id: 0,
            };

            let info_is_ok = queue.get_info_queue();

            if mode == Mode::ReadWrite {
                let file_name_lock = QUEUE_PATH.to_owned() + "/" + queue_name + "_queue.lock";

                match File::open(file_name_lock) {
                    Ok(file) => {
                        if let Err(e) = file.lock_exclusive() {
                            error!("queue:{}:{} attempt lock, err={}", queue.name, queue.id, e);
                            return Err(ErrorQueue::AlreadyOpen);
                        }
                    }
                    Err(e) => {
                        error!("queue:{}:{} prepare lock, err={}", queue.name, queue.id, e);
                        return Err(ErrorQueue::FailOpen);
                    }
                }

                if info_is_ok {
                    queue.id = queue.id + 1;
                    queue.count_pushed = 0;
                    queue.right_edge = 0;
                }

                let part_name = queue.name.to_owned() + "-" + &queue.id.to_string();

                if Path::new(&part_name).exists() == false {
                    if let Err(e) = create_dir_all(QUEUE_PATH.to_owned() + "/" + &part_name) {
                        error!("queue:{}:{} create path, err={}", queue.name, queue.id, e);
                        return Err(ErrorQueue::FailWrite);
                    }
                }

                if let Err(e) = queue.open_part(queue.id) {
                    error!("queue:{}:{} open part, err={:?}", queue.name, queue.id, e);
                    return Err(ErrorQueue::FailOpen);
                }

                if let Err(e) = queue.put_info_queue() {
                    error!("queue:{}:{} open, write info, err={:?}", queue.name, queue.id, e);
                    return Err(ErrorQueue::FailWrite);
                }
            }

            if info_is_ok {
                if let Err(e) = queue.get_info_of_part(queue.id, true) {
                    error!("queue:{}:{} open, get info of part: {}", queue.name, queue.id, e.as_str());
                }
            }

            return Ok(queue);
        }

        return Err(ErrorQueue::NotReady);
    }

    pub fn push(&mut self, msg: &str, msg_type: MsgType) -> Result<u64, ErrorQueue> {
        let bmsg = msg.as_bytes();

        if self.is_ready == false || self.mode == Mode::Read || bmsg.len() > std::u32::MAX as usize / 2 {
            return Err(ErrorQueue::NotReady);
        }

        let header = Header {
            start_pos: self.right_edge,
            msg_length: bmsg.len() as u32,
            magic_marker: 0xEEFEEFEE,
            count_pushed: self.count_pushed + 1,
            crc: 0,
            msg_type: msg_type,
        };

        let mut bheader = [0; HEADER_SIZE];
        header.to_buf(&mut bheader);

        let mut hash = Hasher::new();
        hash.update(&bheader);
        hash.update(bmsg);

        bheader[21..24].clone_from_slice(&u32::to_ne_bytes(hash.finalize()));
        if let Err(e) = self.ff_queue.write(&bheader) {
            error!("queue:{}:{} push, write header, err={}", self.name, self.id, e);
            return Err(ErrorQueue::FailWrite);
        }
        if let Err(e) = self.ff_queue.write(&bmsg) {
            error!("queue:{}:{} push, write body, err={}", self.name, self.id, e);
            return Err(ErrorQueue::FailWrite);
        }

        self.right_edge = self.right_edge + bheader.len() as u64 + bmsg.len() as u64;
        self.count_pushed = self.count_pushed + 1;

        if let Err(_) = self.put_info_push() {
            self.right_edge = self.right_edge - bheader.len() as u64 - bmsg.len() as u64;
            self.count_pushed = self.count_pushed - 1;
        }

        Ok(self.right_edge)
    }

    fn put_info_push(&mut self) -> Result<(), ErrorQueue> {
        if let Ok(_) = self.ff_info_push.seek(SeekFrom::Start(0)) {
        } else {
            error!("fail put info push, set queue.ready = false");
            self.is_ready = false;
            return Err(ErrorQueue::FailWrite);
        }

        let p = format!("{};{};{};", self.name, self.right_edge, self.count_pushed);
        let mut hash = Hasher::new();
        hash.update(p.as_bytes());

        if let Err(e) = self.ff_info_push.write(format!("{}{}\n", p, hash.finalize()).as_bytes()) {
            error!("fail put info push, set queue.ready = false, err={}", e);
            self.is_ready = false;
            return Err(ErrorQueue::FailWrite);
        }

        Ok(())
    }

    fn put_info_queue(&mut self) -> Result<(), ErrorQueue> {
        if let Ok(_) = self.ff_info_queue.seek(SeekFrom::Start(0)) {
        } else {
            error!("fail put info queue, set queue.ready = false");
            self.is_ready = false;
            return Err(ErrorQueue::FailWrite);
        }

        let p = format!("{};{};", self.name, self.id);
        let mut hash = Hasher::new();
        hash.update(p.as_bytes());

        if let Err(e) = self.ff_info_queue.write(format!("{}{}\n", p, hash.finalize()).as_bytes()) {
            error!("fail put info queue, set queue.ready = false, err={}", e);
            self.is_ready = false;
            return Err(ErrorQueue::FailWrite);
        }

        Ok(())
    }

    pub fn open_part(&mut self, part_id: u32) -> Result<u32, ErrorQueue> {
        if self.is_ready == false {
            return Err(ErrorQueue::NotReady);
        }

        if let Ok(ff) = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .open(QUEUE_PATH.to_owned() + "/" + &self.name + "-" + &part_id.to_string() + "/" + &self.name + "_info_push")
        {
            self.ff_info_push = ff;
        } else {
            error!("[{}] fail open info push, part {}", self.name, part_id);
            self.is_ready = false;
            return Err(ErrorQueue::FailOpen);
        }

        if let Ok(f) = File::open(QUEUE_PATH.to_owned() + "/" + &self.name + "-" + &part_id.to_string() + "/" + &self.name + "_queue") {
            self.ff_queue = f;
        } else {
            error!("[{}] fail open part {}", self.name, part_id);
            self.is_ready = false;
            return Err(ErrorQueue::FailOpen);
        }

        self.id = part_id;

        info!("[{}] open part {}", self.name, part_id);

        return self.get_info_of_part(self.id, false);
    }

    pub fn get_info_queue(&mut self) -> bool {
        let mut res = true;

        let mut id = 0;

        &self.ff_info_queue.seek(SeekFrom::Start(0));
        for line in BufReader::new(&self.ff_info_queue).lines() {
            if let Ok(ll) = line {
                let (queue_name, _id, _crc) = scan_fmt!(&ll.to_owned(), "{};{};{}", String, u32, String);

                match queue_name {
                    Some(q) => {
                        if q != self.name {
                            res = false;
                        }
                    }
                    None => res = false,
                }

                match _id {
                    Some(q) => id = q,
                    None => res = false,
                }
            } else {
                return false;
            }

            break;
        }

        if res == true {
            self.id = id;
        }

        //info!("@ read info_queue: name={}, id={}", self.name, self.id);

        return res;
    }

    pub fn get_info_of_part(&mut self, part_id: u32, reopen: bool) -> Result<u32, ErrorQueue> {
        if self.id != part_id || reopen {
            if let Ok(ff) = OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .open(QUEUE_PATH.to_owned() + "/" + &self.name + "-" + &part_id.to_string() + "/" + &self.name + "_info_push")
            {
                self.ff_info_push = ff;
            } else {
                return Err(ErrorQueue::NotFound);
            }
        }

        let mut res = true;
        let mut right_edge = 0;
        let mut count_pushed = 0;

        &self.ff_info_push.seek(SeekFrom::Start(0));
        for line in BufReader::new(&self.ff_info_push).lines() {
            if let Ok(ll) = line {
                let (queue_name, position, pushed, _crc) = scan_fmt!(&ll.to_owned(), "{};{};{};{}", String, u64, u32, String);

                match queue_name {
                    Some(q) => {
                        if q != self.name {
                            res = false;
                        }
                    }
                    None => res = false,
                }

                match position {
                    Some(q) => right_edge = q,
                    None => res = false,
                }

                match pushed {
                    Some(q) => count_pushed = q,
                    None => res = false,
                }
            } else {
                return Err(ErrorQueue::Other);
            }

            break;
        }

        if res == true {
            self.right_edge = right_edge;
            self.count_pushed = count_pushed;
            return Ok(part_id);
        }

        //info!("queue ({}): count_pushed:{}, right_edge:{}, id:{}, ready:{}", self.name, self.count_pushed, self.right_edge, self.id, self.is_ready);

        return Err(ErrorQueue::Other);
    }
}
