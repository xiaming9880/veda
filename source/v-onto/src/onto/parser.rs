use crate::cbor8individual::*;
use crate::individual::*;
use crate::msgpack8individual::*;

#[derive(PartialEq, Debug)]
pub enum RawType {
    CBOR,
    JSON,
    MSGPACK,
    UNKNOWN,
}

pub fn parse_to_predicate(expect_predicate: &str, raw: &mut RawObj, indv: &mut Individual) -> bool {
    if raw.raw_type == RawType::MSGPACK {
        return parse_msgpack_to_predicate(expect_predicate, raw, indv);
    } else if raw.raw_type == RawType::CBOR {
        return parse_cbor_to_predicate(expect_predicate, raw, indv);
    }

    return false;
}

const MSGPACK_MAGIC_HEADER: u8 = 146;

pub fn raw2individual(raw: &mut RawObj, indv: &mut Individual) -> bool {
    let traw: &[u8] = raw.data.as_slice();

    if traw[0] == MSGPACK_MAGIC_HEADER {
        raw.raw_type = RawType::MSGPACK;
    } else {
        raw.raw_type = RawType::CBOR;
    }

    if raw.raw_type == RawType::MSGPACK {
        return msgpack2individual(raw, indv);
    } else if raw.raw_type == RawType::CBOR {
        return cbor2individual(raw, indv);
    }

    return false;
}
