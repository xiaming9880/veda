/**
 * авторизация
 */

module az.acl;

private
{
    import core.thread, std.stdio, std.conv, std.concurrency, std.file, std.datetime, std.array, std.outbuffer, std.string;
    import veda.type, veda.onto.individual, veda.onto.resource, veda.core.bind.lmdb_header, veda.core.context, veda.core.define,
           veda.core.know_predicates, veda.core.log_msg;
    import util.logger, util.utils, util.cbor, veda.core.util.cbor8individual, util.logger;
    import storage.lmdb_storage;
}

// ////////////// ACLManager

/*********************************************************************
   permissionObject uri
   permissionSubject uri
   permission

   индекс:
                permissionObject + permissionSubject
*********************************************************************/
protected byte err;

// ////// logger ///////////////////////////////////////////
import util.logger;
logger _log;
logger log()
{
    if (_log is null)
        _log = new logger("veda-core-" ~ process_name, "log", "ACL");
    return _log;
}
// ////// ////// ///////////////////////////////////////////

public string backup(Context ctx, string backup_id)
{
    string res;

    Tid    tid_acl_manager = ctx.getTid(P_MODULE.acl_manager);

    send(tid_acl_manager, CMD.BACKUP, backup_id, thisTid);
    receive((string _res) { res = _res; });

    return res;
}

/// Хранение, чтение PermissionStatement, Membership
class Authorization : LmdbStorage
{
    this(string _path, DBMode mode, string _parent_thread_name)
    {
        super(_path, mode, _parent_thread_name);
    }

    bool isExistMemberShip(Individual *membership)
    {
        if (membership is null)
            return true;

        bool[ string ] add_memberOf;

        Resources resources = membership.getResources(veda_schema__resource);
        Resources memberOf  = membership.getResources(veda_schema__memberOf);

        foreach (mb; memberOf)
            add_memberOf[ mb.uri ] = true;

        int need_found_count = cast(int)add_memberOf.length;

        if (resources.length > 0)
        {
            string groups_str = find(resources[ 0 ].uri);
            if (groups_str !is null)
            {
                string[] groups = groups_str.split(";");

                foreach (group; groups)
                {
                    if (group.length > 0)
                    {
                        if (add_memberOf.get(group, false) == true)
                        {
                            need_found_count--;
                            if (need_found_count <= 0)
                                break;
                        }
                    }
                }
            }
            else
                return false;
        }

        if (need_found_count == 0)
        {
            //writeln("MemberShip already exist:", *membership);
            return true;
        }
        else
            return false;
    }

    bool isExistPermissionStatement(Individual *prst)
    {
        //writeln ("@  isExistPermissionStatement uri=", prst.uri);

        byte  count_new_bits    = 0;
        byte  count_passed_bits = 0;
        ubyte access;

        void check_access_bit(Resource canXXX, ubyte true_bit_pos, ubyte false_bit_pos)
        {
            if (canXXX !is Resource.init)
            {
                if (canXXX == true)
                {
                    count_new_bits++;
                    if (access & true_bit_pos)
                        count_passed_bits++;
                }
                else
                {
                    count_new_bits++;
                    if (access & false_bit_pos)
                        count_passed_bits++;
                }
            }
        }


        Resource permissionObject  = prst.getFirstResource(veda_schema__permissionObject);
        Resource permissionSubject = prst.getFirstResource(veda_schema__permissionSubject);

        string   str = find(permissionObject.uri ~ "+" ~ permissionSubject.uri);

        if (str !is null && str.length > 0)
        {
            access = cast(ubyte)str[ 0 ];

            check_access_bit(prst.getFirstResource("v-s:canCreate"), Access.can_create, Access.cant_create);
            check_access_bit(prst.getFirstResource("v-s:canDelete"), Access.can_delete, Access.cant_delete);
            check_access_bit(prst.getFirstResource("v-s:canRead"), Access.can_read, Access.cant_read);
            check_access_bit(prst.getFirstResource("v-s:canUpdate"), Access.can_update, Access.cant_update);
        }
        else
        {
            if (trace_msg[ 115 ] == 1)
                log.trace("ACL NOT FOUND -> %s", permissionObject.uri ~ "+" ~ permissionSubject.uri);
            return false;
        }

        if (count_passed_bits < count_new_bits)
        {
            if (trace_msg[ 115 ] == 1)
                log.trace("PermissionStatement not exist, count_passed_bits = %d, count_new_bits=%d", count_passed_bits, count_new_bits);

            return false;
        }
        else
        {
            if (trace_msg[ 115 ] == 1)
                log.trace("PermissionStatement already exist: %s", *prst);
            return true;
        }
    }

    string[][ string ] subject_groups_cache;
    ubyte[ 1024 ] buff_permissions;
    string[ 1024 ] buff_subject_group;
    string[ 1024 ] buff_object_group;

    int count_permissions = 0;


    ubyte authorize(string uri, Ticket *ticket, ubyte request_access, Context context, void delegate(string resource_group,
                                                                                                     string subject_group,
                                                                                                     string right) trace = null)
    {
        void reopen_db()
        {
            //log.trace("@ACL:reopen_db");
            this.reopen_db();
            subject_groups_cache[ ticket.user_uri ] = string[].init;
        }

        ubyte res = 0;

        if (ticket is null)
            return request_access;

        //writeln ("@p request_access=", request_access);

        if (trace_msg[ 111 ] == 1)
            log.trace("authorize %s", uri);

        MDB_txn *txn_r;
        MDB_dbi dbi;
        string  str;
        int     rc;

        context.acl_check_for_reload(&reopen_db);

        if (db_is_open.get(path, false) == false)
            return res;

        rc = mdb_txn_begin(env, null, MDB_RDONLY, &txn_r);
        if (rc == MDB_BAD_RSLOT)
        {
            log.trace_log_and_console("warn: find 1:" ~ text(__LINE__) ~ "(%s) MDB_BAD_RSLOT", path);
            for (int i = 0; i < 10 && rc != 0; i++)
            {
                mdb_txn_abort(txn_r);

                if (i > 3)
                {
                    log.trace_log_and_console("warn: find 1:" ~ text(__LINE__) ~ "(%s) MDB_BAD_RSLOT", path);
                    core.thread.Thread.sleep(dur!("msecs")(10));
                }

                rc = mdb_txn_begin(env, null, MDB_RDONLY, &txn_r);
            }
            subject_groups_cache[ ticket.user_uri ] = string[].init;
        }

        if (rc != 0)
        {
            if (rc == MDB_MAP_RESIZED)
            {
                log.trace_log_and_console(__FUNCTION__ ~ ":" ~ text(__LINE__) ~ "(%s) WARN:%s", path, fromStringz(mdb_strerror(rc)));
                reopen_db();
                rc                                      = mdb_txn_begin(env, null, MDB_RDONLY, &txn_r);
                subject_groups_cache[ ticket.user_uri ] = string[].init;
            }
            else if (rc == MDB_BAD_RSLOT)
            {
                log.trace_log_and_console("warn 2: find:" ~ text(__LINE__) ~ "(%s) MDB_BAD_RSLOT", path);
                mdb_txn_abort(txn_r);

                // TODO: sleep ?
                //core.thread.Thread.sleep(dur!("msecs")(1));
                //rc = mdb_txn_begin(env, null, MDB_RDONLY, &txn_r);
                reopen_db();
                rc                                      = mdb_txn_begin(env, null, MDB_RDONLY, &txn_r);
                subject_groups_cache[ ticket.user_uri ] = string[].init;
            }
        }

        if (rc != 0)
        {
            log.trace_log_and_console(__FUNCTION__ ~ ":" ~ text(__LINE__) ~ "(%s) ERR:%s", path, fromStringz(mdb_strerror(rc)));
            return res;
        }

        try
        {
            rc = mdb_dbi_open(txn_r, null, MDB_CREATE, &dbi);
            if (rc != 0)
                throw new Exception(cast(string)("Fail:" ~  fromStringz(mdb_strerror(rc))));

            string[] object_groups;
            string[] subject_groups;

            // 1. читаем группы object (uri)
            MDB_val key;
            key.mv_size = uri.length;
            key.mv_data = cast(char *)uri;

            MDB_val data;
            rc = mdb_get(txn_r, dbi, &key, &data);
            if (rc == 0)
            {
                string groups_str = cast(string)(data.mv_data[ 0..data.mv_size ]);

                object_groups = groups_str.split(";");
            }
            object_groups ~= uri;
            object_groups ~= veda_schema__AllResourcesGroup;


            // 2. читаем группы subject (ticket.user_uri)

            subject_groups = subject_groups_cache.get(ticket.user_uri, string[].init);

            if (subject_groups == string[].init || subject_groups.length == 0)
            {
                key.mv_size = ticket.user_uri.length;
                key.mv_data = cast(char *)ticket.user_uri;

                rc = mdb_get(txn_r, dbi, &key, &data);
                if (rc == 0)
                {
                    string groups_str = (cast(string)(data.mv_data[ 0..data.mv_size ])).dup;
                    subject_groups = groups_str.split(";");
                }
                subject_groups ~= ticket.user_uri;
                subject_groups_cache[ ticket.user_uri ] = subject_groups;
            }

            if (trace_msg[ 113 ] == 1)
            {
                log.trace("user_uri=%s", ticket.user_uri);
                log.trace("subject_groups=%s", text(subject_groups));
                log.trace("object_groups=%s", text(object_groups));
            }

            count_permissions = 0;

            foreach (subject_group; subject_groups)
            {
                if (res == request_access && trace is null)
                    break;

                if (subject_group.length > 1)
                {
                    foreach (object_group; object_groups)
                    {
                        if (res == request_access && trace is null)
                            break;

                        if (object_group.length > 1)
                        {
                            // 3. поиск подходящего acl
                            string acl_key = object_group ~ "+" ~ subject_group;

                            if (trace_msg[ 112 ] == 1)
                                log.trace("look acl_key: [%s]", acl_key);

                            key.mv_size = acl_key.length;
                            key.mv_data = cast(char *)acl_key;

                            rc = mdb_get(txn_r, dbi, &key, &data);
                            if (rc == 0)
                            {
                                str = cast(string)(data.mv_data[ 0..data.mv_size ]);

                                if (trace_msg[ 112 ] == 1)
                                    log.trace("for [%s] found %s", acl_key, text (getAccessListFromByte (cast(ubyte)str[ 0 ])));

                                if (str !is null && str.length > 0)
                                {
                                    buff_permissions[ count_permissions ] = cast(ubyte)str[ 0 ];

                                    if (trace !is null)
                                    {
                                        buff_subject_group[ count_permissions ] = subject_group;
                                        buff_object_group[ count_permissions ]  = object_group;
                                    }
                                    count_permissions++;
                                }
                            }
                        }
                    }
                }
            }

			//log.trace ("count_permissions = %d", count_permissions);

            // found can rights
            for (int pos = 0; pos < count_permissions; pos++)
            {
                ubyte permission = (0xFF & buff_permissions[ pos ]);
								
                if (permission == 0)
                    continue;

				//log.trace ("permission[%d]=%s", pos, text (getAccessListFromByte(permission)));

                foreach (int idx, access; access_list)
                {
                    if ((request_access & access) != 0)
                    {
                        ubyte set_bit = cast(ubyte)(access & permission);

                        if (set_bit > 0)
                        {
                            if (trace !is null)
                                trace(buff_object_group[ pos ], buff_subject_group[ pos ], access_list_predicates[ idx ]);

                            res = cast(ubyte)(res | set_bit);

                            //if (res == request_access && trace is null)
                            //    break;
                        }
                    }
                }
            }

            // found can't rights
            for (int pos = 0; pos < count_permissions; pos++)
            {
                ubyte permission = (0xFF00 & buff_permissions[ pos ]) >> 4;

                if (permission == 0)
                    continue;
                    
                foreach (int idx, access; denied_list)
                {
                    if ((request_access & access) != 0)
                    {
                        ubyte set_bit = cast(ubyte)(access & permission);

                        if (set_bit > 0)
                        {
                            if (trace !is null)
                                trace(buff_object_group[ pos ], buff_subject_group[ pos ], access_list_predicates[ idx ]);

                            res = cast(ubyte)(res | !set_bit);

                            //if (res == request_access && trace is null)
                            //    break;
                        }
                    }
                }
            }
            
        }catch (Exception ex)
        {
            writeln("EX!,", ex.msg);
        }

        scope (exit)
        {
            mdb_txn_abort(txn_r);

            if (trace_msg[ 111 ] == 1)
                log.trace("authorize %s, request=%s, answer=%s", uri, text(request_access), text(res));
        }

        if (trace_msg[ 111 ] == 1)
            log.trace("acl:res=%d", res);

        return res;
    }
}

private Access[] getAccessListFromByte (ubyte permission)
{
	Access[] res;
		
                foreach (int idx, access; access_list)
                {
                        ubyte set_bit = cast(ubyte)(access & permission);

                        if (set_bit > 0)
                        	res ~= access;
                }		
                foreach (int idx, access; denied_list)
                {
                        ubyte set_bit = cast(ubyte)(access & permission);

                        if (set_bit > 0)
                        	res ~= access;
                }		
		
	return res;
}

void acl_manager(string thread_name, string db_path)
{
    int                          size_bin_log     = 0;
    int                          max_size_bin_log = 10_000_000;

    core.thread.Thread.getThis().name = thread_name;
//    writeln("SPAWN: acl manager");
    LmdbStorage                  storage      = new LmdbStorage(acl_indexes_db_path, DBMode.RW, "acl_manager");
    string                       bin_log_name = get_new_binlog_name(db_path);

    // SEND ready
    receive((Tid tid_response_reciever)
            {
                send(tid_response_reciever, true);
            });
    while (true)
    {
        receive(
                (CMD cmd)
                {
                    if (cmd == CMD.COMMIT)
                    {
                        storage.flush(1);
                    }
                },
                (CMD cmd, EVENT type, string msg, long op_id)
                {
                    if (cmd == CMD.PUT)
                    {
                        try
                        {
                            Individual ind;
                            if (cbor2individual(&ind, msg) < 0)
                            {
                                log.trace("!ERR:invalid individual: [%s]", msg);
                                return;
                            }

                            Resources rdfType = ind.resources[ rdf__type ];

                            if (rdfType.anyExist(veda_schema__PermissionStatement) == true)
                            {
                                if (trace_msg[ 114 ] == 1)
                                    log.trace("store PermissionStatement: [%s]", ind);

                                Resource permissionObject = ind.getFirstResource(veda_schema__permissionObject);
                                Resource permissionSubject = ind.getFirstResource(veda_schema__permissionSubject);

                                ubyte access;

                                // найдем предыдущие права для данной пары
                                string str = storage.find(permissionObject.uri ~ "+" ~ permissionSubject.uri);
                                if (str !is null && str.length > 0)
                                {
                                    access = cast(ubyte)str[ 0 ];
                                }

                                Resource canCreate = ind.getFirstResource("v-s:canCreate");
                                if (canCreate !is Resource.init && canCreate == true)
                                    access = access | Access.can_create;

                                Resource canDelete = ind.getFirstResource("v-s:canDelete");
                                if (canDelete !is Resource.init && canDelete == true)
                                    access = access | Access.can_delete;

                                Resource canRead = ind.getFirstResource("v-s:canRead");
                                if (canRead !is Resource.init && canRead == true)
                                    access = access | Access.can_read;

                                Resource canUpdate = ind.getFirstResource("v-s:canUpdate");
                                if (canUpdate !is Resource.init && canUpdate == true)
                                    access = access | Access.can_update;

                                Resource cantCreate = ind.getFirstResource("v-s:cantCreate");
                                if (cantCreate !is Resource.init && cantCreate == true)
                                    access = access | Access.cant_create;

                                Resource cantDelete = ind.getFirstResource("v-s:cantDelete");
                                if (cantDelete !is Resource.init && cantDelete == true)
                                    access = access | Access.cant_delete;

                                Resource cantRead = ind.getFirstResource("v-s:cantRead");
                                if (cantRead !is Resource.init && cantRead == true)
                                    access = access | Access.cant_read;

                                Resource cantUpdate = ind.getFirstResource("v-s:cantUpdate");
                                if (cantUpdate !is Resource.init && cantUpdate == true)
                                    access = access | Access.cant_update;

                                ResultCode res = storage.put(permissionObject.uri ~ "+" ~ permissionSubject.uri, "" ~ access);

                                if (trace_msg[ 100 ] == 1)
                                    log.trace("[acl index] (%s) ACL: %s+%s %s", text(res), permissionObject.uri, permissionSubject.uri,
                                              text(access));
                            }
                            else if (rdfType.anyExist(veda_schema__Membership) == true)
                            {
                                if (trace_msg[ 114 ] == 1)
                                    log.trace("store Membership: [%s]", ind);

                                bool[ string ] add_memberOf;
                                Resources resource = ind.getResources(veda_schema__resource);
                                Resources memberOf = ind.getResources(veda_schema__memberOf);

                                foreach (mb; memberOf)
                                    add_memberOf[ mb.uri ] = true;

                                foreach (rs; resource)
                                {
                                    bool[ string ] new_memberOf = add_memberOf.dup;
                                    string groups_str = storage.find(rs.uri);
                                    if (groups_str !is null)
                                    {
                                        string[] groups = groups_str.split(";");
                                        foreach (group; groups)
                                        {
                                            if (group.length > 0)
                                                new_memberOf[ group ] = true;
                                        }
                                    }

                                    OutBuffer outbuff = new OutBuffer();
                                    foreach (key; new_memberOf.keys)
                                    {
                                        outbuff.write(key);
                                        outbuff.write(';');
                                    }

                                    ResultCode res = storage.put(rs.uri, outbuff.toString());

                                    if (trace_msg[ 101 ] == 1)
                                        log.trace("[acl index] (%s) MemberShip: %s : %s", text(res), rs.uri, outbuff.toString());
                                }
                            }
                        }
                        finally
                        {
                            set_acl_manager_op_id(op_id);
                        }
                    }
                },
                (CMD cmd, Tid tid_response_reciever)
                {
                    if (cmd == CMD.NOP)
                        send(tid_response_reciever, true);
                    else
                        send(tid_response_reciever, false);
                },
                (CMD cmd, string msg, Tid tid_response_reciever)
                {
                    if (cmd == CMD.BACKUP)
                    {
                        try
                        {
                            string backup_id;
                            if (msg.length > 0)
                                backup_id = msg;

                            if (backup_id is null)
                                backup_id = "0";

                            Result res = storage.backup(backup_id);
                            if (res == Result.Ok)
                            {
                                size_bin_log = 0;
                                bin_log_name = get_new_binlog_name(db_path);
                            }
                            else if (res == Result.Err)
                            {
                                backup_id = "";
                            }
                            send(tid_response_reciever, backup_id);
                        }
                        catch (Exception ex)
                        {
                            send(tid_response_reciever, "");
                        }
                    }
                    else
                    {
                        send(tid_response_reciever, "?");
                    }
                },
                (CMD cmd, int arg, bool arg2)
                {
                    if (cmd == CMD.SET_TRACE)
                        set_trace(arg, arg2);
                },
                (Variant v) { writeln(thread_name, "::acl_manager::Received some other type: [", v, "]"); });
    }
}
