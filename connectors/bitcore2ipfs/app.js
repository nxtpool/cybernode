var constants = require('./app/constants');
var indexer = require('./app/indexer');
var bitcore = require('./app/bitcore.service');
var ipfs = require('./app/ipfs.service.js');
var async = require('async');

var mainStart =  new Date();
var inserted = 0;

ipfs.getHeight(function (data) {
    if (data instanceof Error) {
        console.error(data);
        return;
    }
    var start = data ? Math.max(constants.SOURCE_START_HEIGHT, parseInt(data.message)) : constants.SOURCE_START_HEIGHT;
    async.parallel([
            function () {
                formBlockHashQueue(start);
            },
            function () {
                formTxHashQueue(start);
            }, processTxHashQueue, insertData
        ],
        function () {
        });
});


var blockHashes = {};
var txHashes = [];

var blocks = {};
var completeBlocks = [];

const BLOCK_HASH_QUEUE_LIMIT = 10;
const TX_HASH_QUEUE_LIMIT = 10000;
const BLOCK_HASH_QUEUE_DELAY = 100;
const TX_HASH_QUEUE_DELAY = 100;
const WAIT_NEXT_BLOCK_HASH_DELAY = 10;
const WAIT_NEXT_TX_HASH_DELAY = 10;
const BLOCK_IN_PARALEL = 7;
const TX_IN_PARALEL = 7;
const TX_PROCESSING_QUEUE_DELAY = 100;
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
        if (txHashes.length > TX_HASH_QUEUE_LIMIT || processing > BLOCK_IN_PARALEL - completeBlocks.length / STORE_QUEUE_THREAD_DECREASE_STEP) {
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
                txHashes = txHashes.concat(block.tx.map(
                    function (tx) {
                        return {tx: tx, block: hash};
                    }));
                blocks[block.hash] = {block: block, txs: []};
                /*
                 insertBlock(block, function() {
                 console.log('Processed block: ' + hash);
                 });
                 */
                delete blockHashes['h' + requestHeight];
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


function processTxHashQueue() {
    var processing = 0;
    async.forever(function (next) {
        //console.log('processTxHashQueue');
        if (processing > TX_IN_PARALEL - completeBlocks.length / STORE_QUEUE_THREAD_DECREASE_STEP) {
            setTimeout(function () {
                next();
            }, TX_PROCESSING_QUEUE_DELAY);
            return;
        }

        const txHash = txHashes.shift();
        if (!txHash) {
            setTimeout(function () {
                next();
            }, WAIT_NEXT_TX_HASH_DELAY);
            return;
        }
        if (txHash.tx === ABSENT_TX) {
            next();
            return;
        }
        processing++;
        bitcore.getTxById(txHash.tx, function (tx) {
            if (!tx) {
                console.error('Something wrong!!! Should not be here!!! Failed to get tx: ' + hash);
            } else {
                //console.log('Received tx: ' + txHash.tx);

                const block = blocks[txHash.block];
                block.txs.push(tx);
                if (block.block.tx.length === block.txs.length) {
                    completeBlocks.push(block);
                    console.log('Block downloaded:' + txHash.block);
                    delete blocks[txHash.block];
                }
                /*
                 insertTx(tx, function () {
                 console.log('Processed tx: ' + hash);
                 });
                 */
            }
            processing--;
        });
        next();
    }, function (err) {
        console.error('Process Tx Hash Queue failed' + err);
    });
}

function insertData() {
    async.forever(function (next) {
        const block = completeBlocks.shift();
        if (!block) {
            setTimeout(function () {
                next();
            }, WAIT_BLOCK_DOWNLOAD_DELAY);
            return;
        }
        console.log('insert queue:' + completeBlocks.length);
        async.eachSeries(block.txs,
            function(tx, nextTx) {
                insertTxNoCheck(tx, function () {
                    //console.log('Processed tx: ' + tx.txid);
                    nextTx();
                });
            },
            function (err) {
                insertBlockNoCheck(block.block, function() {
                    //console.log('Processed block: ' + block.block.hash);
                    inserted++;
                    console.log('Inserted: ' + inserted + ' takes:'+(new Date().getTime() - mainStart.getTime()) + ' millis');
                    next();
                });
            }
        )
    }, function (err) {
        console.error('Insert data failed' + err);
    });
}

function insertBlockNoCheck(block, callback) {
    const start = new Date();
    ipfs.insertBlock(block, function (hash) {
        console.log("index: " + block.hash + " -> " + hash.message + ' takes:'+(new Date().getTime() - start.getTime()) + ' millis');
        callback(true);
    });
}

function insertTxNoCheck(tx, callback) {
    const start = new Date();
    ipfs.insertTx(tx, function (hash) {
        console.log("indexTx: " + tx.txid + " -> " + hash.message + 'takes:'+(new Date().getTime() - start.getTime()) + ' millis');
        callback(true);
    });
}

function insertBlock(block, callback) {
    const start = new Date();
    async.waterfall([
        function (next) {
            ipfs.getBlockByHash(block.hash, function (stored) {
                next(null, block, stored);
            });
        },
        function (block, stored, next) {
            if (!stored) {
                next(null, block);
            } else{
                next({exist: true});
            }
        },
        function (block, next) {
            ipfs.insertBlock(block, function (hash) {
                next(null, block, hash);
            });
        }
    ], function (err, block, hash) {
        if (err) {
            if (!err.exist) {
                console.error("index: " + err);
            }
            callback(err.exist);
            return;
        }
        //FIXME need height to log
        console.log("index: " + block.hash + " -> " + hash.message + 'takes:'+(new Date().getTime() - start.getTime()) + ' millis');
        callback(true);
    });
}

function insertTx(tx, callback) {
    const start = new Date();
    async.waterfall([
        function (next) {
            ipfs.getTxByTxid(tx.txid, function (stored) {
                next(null, tx, stored);
            });
        },
        function (tx, stored, next) {
            if (!stored) {
                next(null, tx);
            } else{
                next({exist: true});
            }
        },
        function (tx, next) {
            ipfs.insertTx(tx, function (hash) {
                next(null, tx, hash);
            });
        }
    ], function (err, tx, hash) {
        if (err) {
            if (!err.exist) {
                console.error("index: " + err);
            }
            callback(err.exist);
            return;
        }
        console.log("indexTx: " + tx.txid + " -> " + hash.message + 'takes:'+(new Date().getTime() - start.getTime()) + ' millis');
        callback(true);
    });
}
