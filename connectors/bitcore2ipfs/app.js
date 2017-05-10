var constants = require('./app/constants');
var indexer = require('./app/indexer');
var bitcore = require('./app/bitcore.service');
var ipfs = require('./app/ipfs.service.js');
var async = require('async');
var config = require('./config.json');
var fs = require('./app/fs.service');

var mainStart =  new Date();
var inserted = 0;
var insertedTx = 0;

ipfs.getHeight(function (data) {
    if (data instanceof Error) {
        console.error(data);
        return;
    }

    var start = constants.SOURCE_START_HEIGH;
    if (config.test.startBlock > 0) {
        start = config.test.startBlock
    } else if (data) {
        start = Math.max(constants.SOURCE_START_HEIGHT, parseInt(data.message))
    }

    async.parallel([
            function () {
                formBlockHashQueue(start);
            },
            function () {
                formTxHashQueue(start);
            }, insertData
        ],
        function () {
        });
});


var blockHashes = {};
var completeBlocks = [];

const BLOCK_HASH_QUEUE_LIMIT = 10;
const BLOCK_HASH_QUEUE_DELAY = 100;
const TX_HASH_QUEUE_DELAY = 100;
const WAIT_NEXT_BLOCK_HASH_DELAY = 10;
const BLOCK_IN_PARALEL = 7;
const WAIT_BLOCK_DOWNLOAD_DELAY = 1000;
const STORE_QUEUE_THREAD_DECREASE_STEP = 10;

const ABSENT_TX = "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b";

function formBlockHashQueue(start) {
    var height = start;
    async.forever(function (next) {
        //console.log('formBlockHashQueue:'+ height);
        if (Object.keys(blockHashes).length > BLOCK_HASH_QUEUE_LIMIT) {
            setTimeout(function () {
                next();
            }, BLOCK_HASH_QUEUE_DELAY);
            return;
        }

        const requestHeight = height;
        blockHashes['h' + requestHeight] = null;
        bitcore.getBlockHashByHeight(requestHeight, function (hash) {
            blockHashes['h' + requestHeight] = hash;
        });
        height++;
        next();

    }, function (err) {
        console.error('Form Block Hash Queue failed' + err);
    });
}

function formTxHashQueue(start) {
    var processing = 0;
    var height = start;
    async.forever(function (next) {
        //console.log('formTxHashQueue:'+height);
        if (processing > BLOCK_IN_PARALEL - completeBlocks.length / STORE_QUEUE_THREAD_DECREASE_STEP) {
            setTimeout(function () {
                next();
            }, TX_HASH_QUEUE_DELAY);
            return;
        }

        const requestHeight = height;

        if (!blockHashes['h' + requestHeight]) {
            setTimeout(function () {
                next();
            }, WAIT_NEXT_BLOCK_HASH_DELAY);
            return;
        }
        const hash  = blockHashes['h' + requestHeight];
        bitcore.getBlockByHash(hash, function (block) {
            if (!block) {
                console.error('Something wrong!!! Should not be here!!! Failed to get block: ' + hash);
            } else {
                //console.log('Received block: ' + hash);
                bitcore.getAllTxsByHash(hash, function (txs) {
                    block.tx = txs;
                    if (!config.test.noStore) {
                        completeBlocks.push(block);
                    } else {
                        inserted++;
                        insertedTx += block.tx.length;
                        fs.addRecord({time:new Date().getTime() - mainStart.getTime(), block: inserted, txs:insertedTx});
                        //console.log('Inserted: ' + inserted + ' takes:'+() + ' millis');
                    }
                    //console.log('Block downloaded:' + txHash.block);

                    delete blockHashes['h' + requestHeight];
                });
            }
            processing--;
        });

        processing++;
        height++;
        next();

    }, function (err) {
        console.error('Form Tx Hash Queue failed' + err);
    });
}

function insertData() {
    if (config.test.noStore) {
        return;
    }
    async.forever(function (next) {
        const block = completeBlocks.shift();
        if (!block) {
            setTimeout(function () {
                next();
            }, WAIT_BLOCK_DOWNLOAD_DELAY);
            return;
        }
        console.log('insert queue:' + completeBlocks.length);

        indexer.insertBlockNoCheck(block, function() {
            //console.log('Processed block: ' + block.block.hash);
            inserted++;
            insertedTx += block.tx.length;
            fs.addRecord({time:new Date().getTime() - mainStart.getTime(), block: inserted, txs:insertedTx});
            //console.log('Inserted: ' + inserted + ' takes:'+(new Date().getTime() - mainStart.getTime()) + ' millis');
            next();
            }
        )
    }, function (err) {
        console.error('Insert data failed' + err);
    });
}

