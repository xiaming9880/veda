/**
 * fanout module
 */
module veda.fanout_sql;

private import std.stdio, std.conv, std.utf, std.string, std.file, std.datetime, std.array, std.socket, core.thread;
private import backtrace.backtrace, Backtrace = backtrace.backtrace;
private import mysql.d;
private import veda.common.type, veda.core.common.define, veda.onto.resource, veda.onto.lang, veda.onto.individual, veda.util.queue;
private import util.logger, veda.util.cbor, veda.util.cbor8individual, veda.core.storage.lmdb_storage, veda.core.impl.thread_context;
private import veda.core.common.context, veda.util.tools;
private import veda.vmodule.vmodule;

void main(char[][] args)
{
    process_name = "fanout-sql";

    Thread.sleep(dur!("seconds")(1));

    FanoutProcess p_fanout = new FanoutProcess(P_MODULE.fanout_sql, "127.0.0.1", 8091, new Logger("veda-core-fanout-sql", "log", ""));

    p_fanout.run();
}

class FanoutProcess : VedaModule
{
    Mysql      mysql_conn;
    string     database_name;	

    this(P_MODULE _module_name, string _host, ushort _port, Logger log)
    {
        super(_module_name, _host, _port, log);
    }

    override ResultCode prepare(INDV_OP cmd, string user_uri, string prev_bin, ref Individual prev_indv, string new_bin, ref Individual new_indv,
                                string event_id,
                                long op_id)
    {
        try
        {
            if (mysql_conn !is null)
                push_to_mysql(prev_indv, new_indv);
        }
        catch (Throwable ex)
        {
            log.trace("ERR! LINE:[%s], FILE:[%s], MSG:[%s]", __LINE__, __FILE__, ex.msg);
        }

        committed_op_id = op_id;
        return ResultCode.OK;
    }

    override void thread_id()
    {
    }

    override void receive_msg(string msg)
    {
    }

    override Context create_context()
    {
        return null;
    }


    override bool configure()
    {
        log.trace("use configuration: %s", node);

        connect_to_mysql(context);

        return true;
    }

    bool[ string ] isExistsTable;

    private void push_to_mysql(ref Individual prev_indv, ref Individual new_indv)
    {
        try
        {
            isExistsTable = isExistsTable.init;
            //log.trace ("push_to_mysql: prev_indv=%s", prev_indv);
            //log.trace ("push_to_mysql: new_indv=%s", new_indv);

            bool   is_deleted = new_indv.isExists("v-s:deleted", true);

            string isDraftOf            = new_indv.getFirstLiteral("v-s:isDraftOf");
            string actualVersion        = new_indv.getFirstLiteral("v-s:actualVersion");
            string previousVersion_prev = prev_indv.getFirstLiteral("v-s:previousVersion");
            string previousVersion_new  = new_indv.getFirstLiteral("v-s:previousVersion");

            if (isDraftOf !is null)
                return;

            if (is_deleted == false && (actualVersion !is null && actualVersion != new_indv.uri ||
                                        (previousVersion_prev !is null && previousVersion_prev == previousVersion_new)))
                return;

            Resource  created = new_indv.getFirstResource("v-s:created");

            Resources types        = new_indv.getResources("rdf:type");
            bool      need_prepare = false;

            foreach (type; types)
            {
                if (context.get_onto().isSubClasses(type.uri, [ "v-s:Exportable" ]))
                {
                    need_prepare = true;
                    break;
                }
            }


            if (need_prepare)
            {
                foreach (predicate, rss; prev_indv.resources)
                {
                    if (rss.length > 0)
                    {
                        if (create_table_if_not_exists(predicate, rss[ 0 ]) == true)
                        {
                            try
                            {
                                mysql_conn.query("DELETE FROM `?` WHERE doc_id = ?", predicate, prev_indv.uri);
                            }
                            catch (Throwable ex)
                            {
                                log.trace("ERR! push_to_mysql LINE:[%s], FILE:[%s], MSG:[%s]", __LINE__, __FILE__, ex.msg);
                            }
                        }
                    }
                }

                if (is_deleted == false)
                {
                    foreach (predicate, rss; new_indv.resources)
                    {
                        try
                        {
                            if (rss.length > 0)
                            {
                                create_table_if_not_exists(predicate, rss[ 0 ]);

                                foreach (rs; rss)
                                {
                                    mysql_conn.query("SET NAMES 'utf8'");

                                    if (rs.type == DataType.Boolean)
                                    {
                                        if (rs.get!bool == true)
                                            mysql_conn.query("INSERT INTO `?` (doc_id, created, value) VALUES (?, ?, ?)", predicate, new_indv.uri,
                                                             created.asString(), 1);
                                        else
                                            mysql_conn.query("INSERT INTO `?` (doc_id, created, value) VALUES (?, ?, ?)", predicate, new_indv.uri,
                                                             created.asString(), 0);
                                    }
                                    else
                                    {
                                        mysql_conn.query("INSERT INTO `?` (doc_id, created, value, lang) VALUES (?, ?, ?, ?)", predicate,
                                                         new_indv.uri,
                                                         created.asString(),
                                                         rs.asString().toUTF8(), text(rs.lang));
                                    }

                                    log.trace("push_to_mysql: INSERT INTO `%s` (doc_id, created, value, lang) VALUES (%s, %s, %s, %s)", predicate,
                                              new_indv.uri,
                                              created.asString(), rs.asString().toUTF8(), text(rs.lang));
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            log.trace("ERR! push_to_mysql LINE:[%s], FILE:[%s], MSG:[%s]", __LINE__, __FILE__, ex.msg);
                        }
                    }
                }
            }

            //writeln ("@@@@1 insert TO MYSQL IS OK ", text (mysql_conn));
        }
        catch (Throwable ex)
        {
            log.trace("ERR! push_to_mysql LINE:[%s], FILE:[%s], MSG:[%s]", __LINE__, __FILE__, ex.msg);
        }

        //writeln("@@fanout indv.uri=", indv.uri);
    }

    private bool create_table_if_not_exists(string predicate, Resource rs)
    {
        if (isExistsTable.get(predicate, false) == true)
            return true;

        auto rows = mysql_conn.query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = ? AND table_name = ?;", database_name,
                                     predicate);

        if (rows.front()[ 0 ] == "0")
        {
            // create new table
            try
            {
                string sql_type;
                string sql_value_index = ", INDEX civ(`value`)";

                if (rs.type == DataType.Boolean)
                {
                    sql_type = "BOOL";
                }
                else if (rs.type == DataType.Integer)
                {
                    sql_type = "INTEGER";
                }
                else if (rs.type == DataType.Decimal)
                {
                    sql_type = "DECIMAL (10,2)";
                }
                else if (rs.type == DataType.String)
                {
                    sql_type        = "TEXT";
                    sql_value_index = "";
                }
                else if (rs.type == DataType.Uri)
                {
                    sql_type = "CHAR(128)";
                }
                else if (rs.type == DataType.Datetime)
                {
                    sql_type = "DATETIME";
                }

                mysql_conn.query(
                                 "CREATE TABLE `veda_db`.`" ~ predicate ~ "` ("
                                 "`ID` BIGINT NOT NULL AUTO_INCREMENT, "
                                 "`doc_id` CHAR(128) NOT NULL, "
                                 "`created` DATETIME NULL, "
                                 "`value` " ~ sql_type ~ " NULL, "
                                 "`lang` CHAR(2) NULL, "
                                 " PRIMARY KEY (`ID`), "
                                 " INDEX c1(`doc_id`), INDEX c3 (`created`), INDEX c2(`lang`) " ~ sql_value_index ~
                                 ") ENGINE=MyISAM DEFAULT CHARSET=utf8 COLLATE=utf8_bin;");
                isExistsTable[ predicate ] = true;
                log.trace("create table [%s]", predicate);
            }
            catch (Exception ex)
            {
                log.trace("ERR! create_table_if_not_exists LINE:[%s], FILE:[%s], MSG:[%s]", __LINE__, __FILE__, ex.msg);
                throw ex;
            }
            return false;
        }
        else
        {
            isExistsTable[ predicate ] = true;
            return true;
        }
    }

    private void connect_to_mysql(Context context)
    {
        try
        {
            Ticket    sticket = context.sys_ticket();

            Resources gates = node.resources.get("v-s:push_individual_by_event", Resources.init);
            log.trace("connect_to_mysql:found gates: %s", gates);
            foreach (gate; gates)
            {
                Individual connection = context.get_individual(&sticket, gate.uri);

                Resource   transport = connection.getFirstResource("v-s:transport");
                if (transport != Resource.init)
                {
                    if (transport.data() == "mysql")
                    {
                        try
                        {
                            database_name = connection.getFirstLiteral("v-s:sql_database");
                            mysql_conn    = new Mysql(connection.getFirstLiteral("v-s:host"),
                                                      cast(uint)connection.getFirstInteger("v-s:port"),
                                                      connection.getFirstLiteral("v-s:login"),
                                                      connection.getFirstLiteral("v-s:password"),
                                                      database_name);

                            mysql_conn.query("SET NAMES 'utf8'");

                            log.trace("CONNECT TO MYSQL IS OK, %s", text(mysql_conn));
                        }
                        catch (Throwable ex)
                        {
                            log.trace("EX! fanout.connect_to_mysql# EX:[%s], connection=[%s]", ex.toString(), connection);
                        }
                    }
                }
            }
        }
        catch (Throwable ex)
        {
            log.trace("EX! fanout.connect_to_mysql# EX:[%s]", ex.toString());
        }
    }
}


