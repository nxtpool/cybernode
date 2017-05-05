const fs = require('fs');
const FILE = './progress.json';

function addRecord(record, callback) {
    fs.readFile(FILE, 'utf8', function readFileCallback(err, data){
        if (err) {
            data = {
                progress: []
            };
        } else {
            data = JSON.parse(data);
        }
        data.progress.push(record);
        var json = JSON.stringify(data);
        fs.writeFile(FILE, json, 'utf8', callback);

    });
}

module.exports.addRecord = addRecord;