'use strict';

var fs = require('fs');
var http = require('http');
var path = require('path');
var spawn = require('child_process').spawn;
var electron = require('electron-prebuilt');
var finished = require('tap-finished');
var getport = require('getport');
var backoff = require('backoff');
var parallel = require('run-parallel');

var INDEX_PATH = path.join(__dirname, './electron/index.html');
var MAIN_PATH = path.join(__dirname, './electron/main.js');

var fibonacci = backoff.fibonacci({
  randomisationFactor: 0.1,
  initialDelay: 1,
  factor: 1.1,
  maxDelay: 3000
});

function findPort(cb) {
  fibonacci.on('ready', function(number, delay) {
    getport(function (err, port) {
      if (err) {
        return fibonacciBackoff.backoff();
      }
      return cb(null, port);
    });
  });
  fibonacci.on('fail', function() {
    return cb('could not find port');
  });
  fibonacci.backoff();
}

function runElectron(entry, cb) {
  var child;
  var coverage = {};
  var exitCode = 0;
  var tasks = [];
  // ensure child process gets killed
  process.on('exit', function () {
    if (child && child.connected) {
      child.send({exit: true});
    }
  });
  tasks.push(findPort);
  child = spawn(electron, [MAIN_PATH, entry], {
    stdio: [null, null, null, 'ipc']
  });
  tasks.push(function(cb) {
    child.on('message', function (message) {
      if (message.ready) {
        cb();
      }
    });
  });
  child.stdout.pipe(finished(function (results) {
    if (!results.ok) {
      exitCode = 1;
    }
    if (child.connected) {
      child.send({done: true});
    }
  }));
  child.on('exit', function (code) {
    if (code) {
      exitCode = code;
    }
    cb(coverage, exitCode);
  });
  child.on('message', function (message) {
    if (message.coverage) {
      coverage = message.coverage;
    } else if (message.error) {
      exitCode = 1;
    }
  });
  parallel(tasks, function (err, results) {
    if (err) {
      throw err;
    }
    var port = results[0];
    startServer(port, function () {
      child.send({port: port});
    });
  });
  return child;
}

function startServer(port, cb) {
  var server = http.createServer(function (req, res) {
    res.setHeader('content-type', 'text/html');
    res.setHeader('Access-Control-Allow-Origin', '*');
    fs.createReadStream(INDEX_PATH).pipe(res);
    try {
      server.close();
    } catch (e) {}
  });
  server.listen(port, cb);
}

module.exports = runElectron;
