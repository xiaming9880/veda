use crate::lmdb_storage::LMDBStorage;
use crate::tt_storage::TTStorage;
use v_onto::individual::*;

pub enum StorageError {
    None,
    NotReady,
}

#[derive(PartialEq, Debug, Clone)]
pub enum StorageId {
    Individuals,
    Tickets,
}

pub enum EStorage {
    LMDB(LMDBStorage),
    TT(TTStorage),
}

pub trait Storage {
    fn set_binobj(&mut self, storage: StorageId, uri: &str, iraw: &mut Individual) -> bool;
}

pub struct VStorage {
    storage: EStorage,
}

impl VStorage {
    pub fn new_tt(tt_uri: String, login: &str, pass: &str) -> VStorage {
        VStorage {
            storage: EStorage::TT(TTStorage::new(tt_uri, login, pass)),
        }
    }

    pub fn new_lmdb(db_path: &str) -> VStorage {
        VStorage {
            storage: EStorage::LMDB(LMDBStorage::new(db_path)),
        }
    }

    pub fn set_binobj(&mut self, uri: &str, iraw: &mut Individual) -> bool {
        match &mut self.storage {
            EStorage::TT(s) => s.set_binobj(StorageId::Individuals, uri, iraw),
            EStorage::LMDB(s) => s.set_binobj(StorageId::Individuals, uri, iraw),
        }
    }

    pub fn set_binobj_db(&mut self, storage: StorageId, uri: &str, iraw: &mut Individual) -> bool {
        match &mut self.storage {
            EStorage::TT(s) => s.set_binobj(storage, uri, iraw),
            EStorage::LMDB(s) => s.set_binobj(storage, uri, iraw),
        }
    }
}
