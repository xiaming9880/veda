/// This module gives function to check access of user to individual
pub mod common;

use std::collections::HashMap;

use crate::common::*;

pub struct Right {
    pub id: String,
    pub access: u8,
    marker: char,
    is_deleted: bool,
    level: u8,
}

pub struct AzContext<'a> {
    uri: &'a str,
    user_uri: &'a str,
    request_access: u8,
    calc_right_res: u8,
    is_need_exclusive_az: bool,
    is_found_exclusive_az: bool,
    walked_groups_s: &'a mut HashMap<String, (u8, char)>,
    tree_groups_s: &'a mut HashMap<String, String>,
    walked_groups_o: &'a mut HashMap<String, u8>,
    tree_groups_o: &'a mut HashMap<String, String>,
    subject_groups: &'a mut HashMap<String, Right>,
    checked_groups: &'a mut HashMap<String, u8>,
}

fn authorize_obj_group(
    azc: &mut AzContext,
    trace: &mut Trace,
    request_access: u8,
    object_group_id: &str,
    object_group_access: u8,
    filter_value: &str,
    db: &dyn Storage,
) -> Result<bool, i64> {
    let mut is_authorized = false;
    let mut calc_bits;

    if !trace.is_info && !trace.is_group && !trace.is_acl {
        let left_to_check = (azc.calc_right_res ^ request_access) & request_access;

        if left_to_check & object_group_access == 0 {
            return Ok(is_authorized);
        }

        if let Some(v) = azc.checked_groups.get(object_group_id) {
            if *v == object_group_access {
                return Ok(is_authorized);
            }
        }

        azc.checked_groups.insert(object_group_id.to_string(), object_group_access);
    }

    db.fiber_yield();

    if trace.is_group {
        print_to_trace_group(trace, format!("{}\n", object_group_id));
    }

    let acl_key = if !filter_value.is_empty() {
        PERMISSION_PREFIX.to_owned() + filter_value + object_group_id
    } else {
        PERMISSION_PREFIX.to_owned() + object_group_id
    };

    match db.get(&acl_key) {
        Ok(str) => {
            let permissions: &mut Vec<Right> = &mut Vec::new();

            get_elements_from_index(&str, permissions);

            for permission in permissions {
                let subj_id = &permission.id;
                if let Some(subj_gr) = azc.subject_groups.get(subj_id) {
                    let obj_restriction_access = object_group_access;
                    let subj_restriction_access = subj_gr.access;

                    let permission_access = if permission.access > 15 {
                        (((permission.access & 0xF0) >> 4) ^ 0x0F) & permission.access
                    } else {
                        permission.access
                    };

                    for i_access in ACCESS_LIST.iter() {
                        let access = *i_access;
                        if (request_access & access & obj_restriction_access & subj_restriction_access) != 0 {
                            calc_bits = access & permission_access;

                            if calc_bits > 0 {
                                let prev_res = azc.calc_right_res;

                                azc.calc_right_res |= calc_bits;

                                if (azc.calc_right_res & request_access) == request_access {
                                    if trace.is_info {
                                    } else if !trace.is_group && !trace.is_acl {
                                        is_authorized = true;
                                        return Ok(is_authorized);
                                    }
                                }

                                if trace.is_info && prev_res != azc.calc_right_res {
                                    let f_log_str = if !filter_value.is_empty() {
                                        ", with filter ".to_owned() + filter_value
                                    } else {
                                        "".to_owned()
                                    };

                                    print_to_trace_info(
                                        trace,
                                        format!(
                                            "found permission S:[{}], O:[{}], access={} {}\n",
                                            &subj_id,
                                            &object_group_id,
                                            access_to_pretty_string(permission_access),
                                            f_log_str
                                        ),
                                    );

                                    print_to_trace_info(
                                        trace,
                                        format!(
                                            "access: request={}, calc={}, total={}\n",
                                            access_to_pretty_string(request_access),
                                            access_to_pretty_string(calc_bits),
                                            access_to_pretty_string(azc.calc_right_res)
                                        ),
                                    );
                                    print_to_trace_info(trace, "O-PATH".to_owned() + &get_path(azc.tree_groups_o, object_group_id.to_string()) + "\n");
                                    print_to_trace_info(trace, "S-PATH".to_owned() + &get_path(azc.tree_groups_s, subj_id.to_string()) + "\n");
                                }

                                if trace.is_acl {
                                    print_to_trace_acl(trace, format!("{};{};{}\n", object_group_id, subj_id, ACCESS_LIST_PREDICATES[*i_access as usize]));
                                }
                            }
                        }
                    }
                }
            }
        }
        Err(e) => {
            if e < 0 {
                eprintln!("ERR! Authorize: authorize_obj_group:main, object_group_id={:?}", object_group_id);
                return Err(e);
            }
        }
    }

    if (azc.calc_right_res & request_access) == request_access {
        if !trace.is_info && !trace.is_group && !trace.is_acl {
            is_authorized = true;
            return Ok(is_authorized);
        }
    }

    Ok(false)
}

fn prepare_obj_group(
    azc: &mut AzContext,
    trace: &mut Trace,
    request_access: u8,
    uri: &str,
    access: u8,
    filter_value: &str,
    level: u8,
    db: &dyn Storage,
) -> Result<bool, i64> {
    if level > 32 {
        return Ok(false);
    }

    db.fiber_yield();

    let mut is_contain_suffix_group = false;
    let groups_set_len;

    match db.get(&(MEMBERSHIP_PREFIX.to_owned() + uri)) {
        Ok(groups_str) => {
            let groups_set: &mut Vec<Right> = &mut Vec::new();
            get_elements_from_index(&groups_str, groups_set);

            groups_set_len = groups_set.len();

            for (idx, group) in groups_set.iter_mut().enumerate().take(groups_set_len) {
                if group.id.is_empty() {
                    eprintln!("WARN! skip, group is null, uri={}, group.id={}", uri, group.id);
                    continue;
                }

                let new_access = group.access & access;
                group.access = new_access;

                let key = group.id.clone();

                if azc.is_need_exclusive_az && !azc.is_found_exclusive_az {
                    if level == 0 {
                        if group.id.contains("_group") {
                            is_contain_suffix_group = true;
                        }

                        if idx == groups_set_len - 1 && !is_contain_suffix_group {
                            azc.is_found_exclusive_az = true;
                        }

                        if group.id.contains("cfg:TTLResourcesGroup") {
                            azc.is_found_exclusive_az = true;
                        }
                    }

                    if !azc.is_found_exclusive_az && (level == 0 || uri.contains("_group")) && azc.subject_groups.contains_key(&key) {
                        if let Some(s_val) = azc.subject_groups.get(&key) {
                            if s_val.marker == M_IS_EXCLUSIVE {
                                azc.is_found_exclusive_az = true;
                            }
                        }
                    }
                }

                if group.marker == M_IS_EXCLUSIVE {
                    continue;
                }

                let mut preur_access = 0;

                if azc.walked_groups_o.contains_key(&key) {
                    preur_access = azc.walked_groups_o[&key];
                    if (preur_access & new_access) == new_access {
                        continue;
                    }
                }

                if trace.is_info {
                    azc.walked_groups_o.insert(key.clone(), new_access | preur_access);
                    azc.tree_groups_o.insert(key.clone(), uri.to_string());
                } else {
                    azc.walked_groups_o.insert(key.clone(), new_access | preur_access);
                }

                if uri == group.id {
                    continue;
                }

                match authorize_obj_group(azc, trace, request_access, &group.id, group.access, filter_value, db) {
                    Ok(res) => {
                        if res {
                            if !azc.is_need_exclusive_az {
                                return Ok(true);
                            }

                            if azc.is_need_exclusive_az && azc.is_found_exclusive_az {
                                return Ok(true);
                            }
                        }
                    }
                    Err(e) => {
                        if e < 0 {
                            return Err(e);
                        }
                    }
                }

                prepare_obj_group(azc, trace, request_access, &group.id, new_access, filter_value, level + 1, db)?;
            }

            if groups_set_len == 0 {
                azc.is_found_exclusive_az = true;
            }

            Ok(false)
        }
        Err(e) => {
            if e < 0 {
                eprintln!("ERR! Authorize: prepare_obj_group {:?}", uri);
                Err(e)
            } else {
                if level == 0 {
                    azc.is_found_exclusive_az = true;
                }
                Ok(false)
            }
        }
    }
}

pub fn authorize(
    uri: &str,
    user_uri: &str,
    request_access: u8,
    filter_value: &str,
    filter_allow_access_to_other: u8,
    db: &dyn Storage,
    trace: &mut Trace,
) -> Result<u8, i64> {
    let s_groups = &mut HashMap::new();

    let mut azc = AzContext {
        uri,
        user_uri,
        request_access,
        calc_right_res: 0,
        is_need_exclusive_az: false,
        is_found_exclusive_az: false,
        walked_groups_s: &mut HashMap::new(),
        tree_groups_s: &mut HashMap::new(),
        walked_groups_o: &mut HashMap::new(),
        tree_groups_o: &mut HashMap::new(),
        subject_groups: &mut HashMap::new(),
        checked_groups: &mut HashMap::new(),
    };

    // читаем группы subject (ticket.user_uri)
    if trace.is_info {
        print_to_trace_info(trace, format!("authorize uri={}, user={}, request_access={}\n", uri, user_uri, access_to_pretty_string(request_access)));
    }

    if let Err(e) = get_resource_groups(azc.walked_groups_s, azc.tree_groups_s, trace, user_uri, 15, s_groups, &filter_value, 0, db, &mut azc.is_need_exclusive_az, false)
    {
        return Err(e);
    }
    db.fiber_yield();

    azc.subject_groups = s_groups;

    azc.subject_groups.insert(
        user_uri.to_string(),
        Right {
            id: user_uri.to_string(),
            access: 15,
            marker: 0 as char,
            is_deleted: false,
            level: 0,
        },
    );

    let mut request_access_t = request_access;
    let empty_filter_value = String::new();

    if !filter_value.is_empty() {
        request_access_t = request_access & filter_allow_access_to_other;
    }

    if !trace.is_info && !trace.is_group && !trace.is_acl {
        match authorize_obj_group(&mut azc, trace, request_access_t, "v-s:AllResourcesGroup", 15, &empty_filter_value, db) {
            Ok(res) => {
                if res {
                    if filter_value.is_empty() || (!filter_value.is_empty() && request_access == azc.calc_right_res) {
                        if final_check(&mut azc, trace) {
                            return Ok(azc.calc_right_res);
                        }
                    }
                }
            }
            Err(e) => return Err(e),
        }

        match authorize_obj_group(&mut azc, trace, request_access_t, uri, 15, &empty_filter_value, db) {
            Ok(res) => {
                if res {
                    if filter_value.is_empty() || (!filter_value.is_empty() && request_access == azc.calc_right_res) {
                        if final_check(&mut azc, trace) {
                            return Ok(azc.calc_right_res);
                        }
                    }
                }
            }
            Err(e) => return Err(e),
        }

        match prepare_obj_group(&mut azc, trace, request_access_t, uri, 15, &empty_filter_value, 0, db) {
            Ok(res) => {
                if res {
                    if filter_value.is_empty() || (!filter_value.is_empty() && request_access == azc.calc_right_res) {
                        if final_check(&mut azc, trace) {
                            return Ok(azc.calc_right_res);
                        }
                    }
                }
            }
            Err(e) => return Err(e),
        }

        if !filter_value.is_empty() {
            azc.checked_groups.clear();
            azc.walked_groups_o.clear();

            match authorize_obj_group(&mut azc, trace, request_access, "v-s:AllResourcesGroup", 15, &filter_value, db) {
                Ok(res) => {
                    if res && final_check(&mut azc, trace) {
                        return Ok(azc.calc_right_res);
                    }
                }
                Err(e) => return Err(e),
            }

            match authorize_obj_group(&mut azc, trace, request_access, uri, 15, &filter_value, db) {
                Ok(res) => {
                    if res && final_check(&mut azc, trace) {
                        return Ok(azc.calc_right_res);
                    }
                }
                Err(e) => return Err(e),
            }

            match prepare_obj_group(&mut azc, trace, request_access, uri, 15, &filter_value, 0, db) {
                Ok(res) => {
                    if res && final_check(&mut azc, trace) {
                        return Ok(azc.calc_right_res);
                    }
                }
                Err(e) => return Err(e),
            }
        }
    } else {
        // IF NEED TRACE

        match authorize_obj_group(&mut azc, trace, request_access_t, "v-s:AllResourcesGroup", 15, &empty_filter_value, db) {
            Ok(res) => {
                if res {
                    if filter_value.is_empty() || (!filter_value.is_empty() && request_access == azc.calc_right_res) {
                        //                    if trace.is_info {
                        //                        print_to_trace_info(trace, format!("RETURN MY BE
                        // ASAP\n"));                    }
                    } else if final_check(&mut azc, trace) {
                        return Ok(azc.calc_right_res);
                    }
                }
            }
            Err(e) => return Err(e),
        }

        match authorize_obj_group(&mut azc, trace, request_access_t, uri, 15, &empty_filter_value, db) {
            Ok(res) => {
                if res {
                    if filter_value.is_empty() || (!filter_value.is_empty() && request_access == azc.calc_right_res) {
                        //                    if trace.is_info {
                        //                        print_to_trace_info(trace, format!("RETURN MY BE
                        // ASAP\n"));                    }
                    } else if final_check(&mut azc, trace) {
                        return Ok(azc.calc_right_res);
                    }
                }
            }
            Err(e) => return Err(e),
        }

        match prepare_obj_group(&mut azc, trace, request_access_t, uri, 15, &empty_filter_value, 0, db) {
            Ok(res) => {
                if res {
                    if filter_value.is_empty() || (!filter_value.is_empty() && request_access == azc.calc_right_res) {
                        //                    if trace.is_info {
                        //                        print_to_trace_info(trace, format!("RETURN MY BE
                        // ASAP\n"));                    }
                    }
                } else if final_check(&mut azc, trace) {
                    return Ok(azc.calc_right_res);
                }
            }
            Err(e) => return Err(e),
        }

        if !filter_value.is_empty() {
            if trace.is_info {
                print_to_trace_info(trace, format!("USE FILTER: [{}]\n", filter_value));
            }

            azc.checked_groups.clear();
            azc.walked_groups_o.clear();

            match authorize_obj_group(&mut azc, trace, request_access, "v-s:AllResourcesGroup", 15, &filter_value, db) {
                Ok(res) => {
                    if res {
                        //                    if trace.is_info {
                        //                        print_to_trace_info(trace, format!("RETURN MY BE
                        // ASAP\n"));                    }
                    } else if final_check(&mut azc, trace) {
                        return Ok(azc.calc_right_res);
                    }
                }
                Err(e) => return Err(e),
            }

            match authorize_obj_group(&mut azc, trace, request_access, uri, 15, &filter_value, db) {
                Ok(res) => {
                    if res {
                        //                    if trace.is_info {
                        //                        print_to_trace_info(trace, format!("RETURN MY BE
                        // ASAP\n"));                    }
                    } else if final_check(&mut azc, trace) {
                        return Ok(azc.calc_right_res);
                    }
                }
                Err(e) => return Err(e),
            }

            match prepare_obj_group(&mut azc, trace, request_access, uri, 15, &filter_value, 0, db) {
                Ok(res) => {
                    if res {
                        //                    if trace.is_info {
                        //                        print_to_trace_info(trace, format!("RETURN MY BE
                        // ASAP\n"));                    }
                    } else if final_check(&mut azc, trace) {
                        return Ok(azc.calc_right_res);
                    }
                }
                Err(e) => return Err(e),
            }
        }
    }

    if final_check(&mut azc, trace) {
        Ok(azc.calc_right_res)
    } else {
        if trace.is_acl {
            trace.acl.clear();
        }

        if trace.is_info {
            print_to_trace_info(
                trace,
                format!(
                    "result: uri={}, user={}, request={}, answer={}\n\n",
                    azc.uri,
                    azc.user_uri,
                    access_to_pretty_string(azc.request_access),
                    access_to_pretty_string(0)
                ),
            );
        }

        Ok(0)
    }
}
