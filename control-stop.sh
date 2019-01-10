#!/bin/bash

TIMESTAMP=`date +%Y-%m-%d_%H_%M`

#mkdir ./logs/$TIMESTAMP
#cp ./logs/*-stderr.log ./logs/$TIMESTAMP

#tarantoolctl stop init_tarantool.lua
pkill tarantool

start-stop-daemon -Kp $PWD/.pids/veda-pid $PWD/veda
start-stop-daemon -Kp $PWD/veda-pid $PWD/veda

target=".pids/"
let count=0
for f in "$target"/*
do
    pid=`cat $target/$(basename $f)`
    echo STOP $pid $target/$(basename $f)
    kill -kill $pid
    let count=count+1
done
echo ""
echo "Count: $count"

rm -f -r .pids
rm -f data/module-info/*.lock
rm -f data/queue/*.lock
rm -f data/uris/*.lock

if [ $1 == "all" ] ; then
    echo STOP ALL VEDA MODULES

    start-stop-daemon -Kp $PWD/veda-pid $PWD/veda
    killall -9 veda
    killall -9 veda-ccus
    killall -9 veda-fanout-email
    killall -9 veda-fanout-sql
    killall -9 veda-fanout-sql-np
    killall -9 veda-fanout-sql-lp
    killall -9 veda-ft-indexer
    killall -9 veda-scripts
    killall -9 veda-mstorage
    killall -9 veda-server
    killall -9 veda-ttlreader
    killall -9 veda-webserver
    killall -9 veda-gowebserver
    killall -9 veda-ft-query
    killall -9 veda-lmdb-srv

    #tarantoolctl stop init_tarantool.lua
    pkill tarantool

fi


exit 0