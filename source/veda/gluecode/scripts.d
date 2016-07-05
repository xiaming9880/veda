/**
 * scripts module
 */
module veda.gluecode.scripts;

private import std.stdio, std.conv, std.utf, std.string, std.file, std.datetime, std.container.array, std.algorithm, std.range;
private import veda.type, veda.core.common.define, veda.onto.resource, veda.onto.lang, veda.onto.individual, veda.util.queue;
private import util.logger, veda.util.cbor, veda.util.cbor8individual, veda.core.storage.lmdb_storage, veda.core.impl.thread_context;
private import veda.core.common.context, veda.util.tools, veda.core.log_msg, veda.core.common.know_predicates, veda.onto.onto;
private import veda.process.child_process;
private import search.vel, search.vql, veda.gluecode.script, veda.gluecode.v8d_header;

void main(char[][] args)
{
    process_name = "scripts";

    core.thread.Thread.sleep(dur!("seconds")(1));

    ScriptProcess p_script = new ScriptProcess(P_MODULE.scripts, "127.0.0.1", 8091);

    p_script.run();
}

class ScriptProcess : ChildProcess
{
    private          ScriptInfo[ string ] event_scripts;
    private          Array!string event_scripts_order;

    private VQL      vql;
    private string   empty_uid;
    private string   vars_for_event_script;
    private string   vars_for_codelet_script;

    private ScriptVM script_vm;

    this(P_MODULE _module_name, string _host, ushort _port)
    {
        super(_module_name, _host, _port);
    }

    long count_sckip = 0;

    override bool prepare(INDV_OP cmd, string user_uri, string prev_bin, ref Individual prev_indv, string new_bin, ref Individual new_indv,
                          string event_id,
                          long op_id)
    {
        if (script_vm is null)
            return false;

        //writeln ("#prev_indv=", prev_indv);
        //writeln ("#new_indv=", new_indv);

        string    individual_id = new_indv.uri;

        bool      prepare_if_is_script = false;

        Resources types      = new_indv.resources.get(rdf__type, Resources.init);
        string[]  indv_types = types.getAsArrayStrings();
        foreach (itype; indv_types)
        {
            if (itype == veda_schema__PermissionStatement || itype == veda_schema__Membership)
                return true;

            if (itype == veda_schema__Event)
                prepare_if_is_script = true;
        }

        if (prepare_if_is_script == false)
        {
            if (event_scripts.get(individual_id, ScriptInfo.init) !is ScriptInfo.init)
                prepare_if_is_script = true;
        }

        if (prepare_if_is_script)
        {
            prepare_script(event_scripts, event_scripts_order, new_indv, script_vm, vars_for_event_script);
        }

        set_g_parent_script_id_etc(event_id);
        set_g_prev_state(prev_bin);

        g_document.data   = cast(char *)new_bin;
        g_document.length = cast(int)new_bin.length;

        if (user_uri !is null)
        {
            g_user.data   = cast(char *)user_uri;
            g_user.length = cast(int)user_uri.length;
        }
        else
        {
            g_user.data   = cast(char *)"cfg:VedaSystem";
            g_user.length = "cfg:VedaSystem".length;
        }

        string sticket = context.sys_ticket().id;
        g_ticket.data   = cast(char *)sticket;
        g_ticket.length = cast(int)sticket.length;

        //writeln ("@S1 sticket=", sticket);

        set_g_super_classes(indv_types, context.get_onto());

        //log.trace("-------------------");
        //log.trace ("indv=%s, indv_types=%s", individual_id, indv_types);
        //log.trace ("queue of scripts:%s", event_scripts_order.array());


        foreach (script_id; event_scripts_order)
        {
            auto script = event_scripts[ script_id ];

            if (script.compiled_script !is null)
            {
                //log.trace("look script:%s", script_id);
                if (event_id !is null && event_id.length > 1 && event_id == (individual_id ~ '+' ~ script_id))
                {
                    //writeln("skip script [", script_id, "], type:", type, ", indiv.:[", individual_id, "]");
                    continue;
                }

                //log.trace("first check pass script:%s, filters=%s", script_id, script.filters);

                if (script.filters.length > 0 && isFiltred(&script, indv_types, context.get_onto()) == false)
                    continue;

                //log.trace("filter pass script:%s", script_id);

                try
                {
/*
    if (count_sckip == 0)
    {
   long now_sckip;
    writefln("... start exec event script : %s %s %d %s", script_id, individual_id, op_id, event_id);
    readf(" %d", &now_sckip);
    count_sckip = now_sckip;
    }

    if (count_sckip > 0)
        count_sckip--;
 */
                    if (trace_msg[ 300 ] == 1)
                        log.trace("start exec event script : %s %s %d %s", script_id, individual_id, op_id, event_id);

                    //count++;
                    script.compiled_script.run();

                    bool res = commit();
                    if (res == false)
                    {
                        log.trace("fail exec event script : %s", script_id);
                        return false;
                    }

                    if (trace_msg[ 300 ] == 1)
                        log.trace("end exec event script : %s", script_id);


                    //*(cast(char*)script_vm) = 0;
                }
                catch (Exception ex)
                {
                    log.trace_log_and_console("WARN! fail execute event script : %s %s", script_id, ex.msg);
                }
            }
        }
//                                writeln("count:", count);

        //clear_script_data_cache ();
        // writeln("scripts B #e *", process_name);
        return true;
    }

    override bool configure()
    {
        vars_for_event_script =
            "var user_uri = get_env_str_var ('$user');"
            ~ "var parent_script_id = get_env_str_var ('$parent_script_id');"
            ~ "var parent_document_id = get_env_str_var ('$parent_document_id');"
            ~ "var prev_state = get_individual (ticket, '$prev_state');"
            ~ "var super_classes = get_env_str_var ('$super_classes');"
            ~ "var _event_id = document['@'] + '+' + _script_id;";

        vql = new VQL(context);

        script_vm = get_ScriptVM(context);
        load_event_scripts();
        
        return true;
    }

    public void load_event_scripts()
    {
        if (script_vm is null)
            return;

        if (trace_msg[ 301 ] == 1)
            log.trace("start load db scripts");

        Ticket       sticket = context.sys_ticket();
        Individual[] res;
        vql.get(&sticket,
                "return { 'v-s:script'} filter { 'rdf:type' === 'v-s:Event'}",
                res);

        int count = 0;

        foreach (ss; res)
        {
            prepare_script(event_scripts, event_scripts_order, ss, script_vm, vars_for_event_script);
        }

        if (trace_msg[ 300 ] == 1)
            log.trace("end load db scripts, count=%d ", res.length);
    }

    private void set_g_parent_script_id_etc(string event_id)
    {
        //writeln ("@d event_id=", event_id);
        string[] aa;

        if (event_id !is null)
        {
            aa = event_id.split("+");

            if (aa.length == 2)
            {
                g_parent_script_id.data     = cast(char *)aa[ 1 ];
                g_parent_script_id.length   = cast(int)aa[ 1 ].length;
                g_parent_document_id.data   = cast(char *)aa[ 0 ];
                g_parent_document_id.length = cast(int)aa[ 0 ].length;
            }
            else
            {
                g_parent_script_id.data     = cast(char *)empty_uid;
                g_parent_script_id.length   = cast(int)empty_uid.length;
                g_parent_document_id.data   = cast(char *)empty_uid;
                g_parent_document_id.length = cast(int)empty_uid.length;
            }
        }
        else
        {
            g_parent_script_id.data     = cast(char *)empty_uid;
            g_parent_script_id.length   = cast(int)empty_uid.length;
            g_parent_document_id.data   = cast(char *)empty_uid;
            g_parent_document_id.length = cast(int)empty_uid.length;
        }
    }
}


