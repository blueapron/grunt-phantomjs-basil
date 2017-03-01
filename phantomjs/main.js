/**
 * grunt-phantomjs-soju
 * https://www.blueapron.com
 *
 * Some code copied and inspired from
 * https://github.com/gruntjs/grunt-lib-phantomjs
 *
 * Copyright (c) 2016 Blue Apron
 * Licensed under the MIT license
 */

/*global phantom:true*/

'use strict';

var fs     = require('fs'),
    system = require('system');

// Temp file for communication
var tempFile = system.args[1];
// URL to load
var url = system.args[2];
// PhantomJS options to pass
var options = JSON.parse(system.args[3]) || {};
var rootPath = system.args[4] || '';

// Default Options
options.webpage = {};
if(!options.timeout) { options.timeout = 8000; }
if(!options.consoleOutput) { options.consoleOutput = false; }

/**
 * Extended Options
 * @screenshotPath (string)
 * @viewport (string)
 */

// Screenshot Option
if(options.screenshotPath) {
  options.screenshotPath = rootPath+'/'+options.screenshotPath+'/';
} else {
  options.screenshotPath = rootPath+'/screenshots/';
}

// Keep track of last message sent
var lastMsgDate = new Date();

// Send messages to the parent by appending to temp file
var sendMessage = function(arg) {
  var args = Array.isArray(arg) ? arg : Array.apply(null, arguments);
  lastMsgDate = new Date();
  fs.write(tempFile, JSON.stringify(args) + '\n', 'a');
}

// This allows grunt to abort if PhantomJS version isn't adequate.
sendMessage('private', 'version', phantom.version);

// Create PhantomJS webpage
var webpage = require('webpage').create(options.webpage);

// Viewport Option
if(options.viewportSize) {
  webpage.viewportSize = options.viewportSize;
}

// Exit PhantomJS if the page doesn't send any messages for a while
setInterval(function() {
  if(new Date() - lastMsgDate > options.timeout) {
    sendMessage('fail.timeout');
    if(options.screenshotOnFail) {
      takeScreenshot({
        name: ['page-at-timeout-', Date.now()].join(''),
        path: 'timeout'
      });
    }
    phantom.exit();
  }
}, 100);

// Inject bridge into phantomjs webpage
var injected;
var inject = function() {
  if(injected) { return; }
  // Inject client-side helper script.
  var scripts = Array.isArray(options.inject) ? options.inject : [options.inject];
  sendMessage('inject', options.inject);
  scripts.forEach(webpage.injectJs);
  injected = true;
};

// Take screenshot of current page
var takeScreenshot = function(option) {
  var opt = {
    name: option.name || Date.now().toString(),
    path: option.path ? option.path + '/' : '',
    rect: option.rect || webpage.viewportSize
  };

  // use clipRect to capture only the area of the specified position
  webpage.clipRect = opt.rect;

  webpage.render([options.screenshotPath, opt.path, opt.name, '.png'].join(''), {format: 'png'});
  return option;
}

// Keep track if the client-side helper script already has been injected
webpage.onUrlChanged = function(newUrl) {
  injected = false;
  sendMessage('onUrlChanged', newUrl);
}

// Receive message from client
webpage.onCallback = function(arg) {
  var args = Array.isArray(arg) ? arg : Array.apply(null, arguments);
  var firstArgStringErrorMsg = typeof args[0] === 'string' ? false : 'First argument of window.callPhantom() must be a string';

  // Check if second argument is an array
  if(firstArgStringErrorMsg) {
    return sendMessage('onCallback.dataError', firstArgStringErrorMsg);
  }

  if(args[0] === 'screenshot') {
    return sendMessage('screenshot', takeScreenshot(args[1]));
  }

  sendMessage(args);
};

// Inject javascript through alert
webpage.onAlert = function(str) {
  // The only thing that should ever alert "inject" is the custom event
  if (str === 'inject') {
    inject();
    return;
  }
};

// Relay console logging messages.
webpage.onConsoleMessage = function(message) {
  if(options.consoleOutput) {
    sendMessage('onConsoleMessage', message);
  }
};


// onResourceRequested block third party script
if (options.onResourceRequested) {
  webpage.onResourceRequested = options.onResourceRequested;
} else {
  // For debugging.
  webpage.onResourceRequested = function(request) {
    sendMessage('onResourceRequested', request);
  };
}

webpage.onResourceReceived = function(request) {
  if (request.stage === 'end') {
    sendMessage('onResourceReceived', request);
  }
};

webpage.onError = function(msg, trace) {
  sendMessage('error.onError', msg, trace);
};

phantom.onError = function(msg, trace) {
  sendMessage('error.onError', msg, trace);
};

// Run before the page is loaded.
webpage.onInitialized = function() {
  sendMessage('onInitialized');

  // Abort if there is no bridge to inject.
  if (!options.inject) { return; }
  // Tell the client that when DOMContentLoaded fires, it needs to tell this
  // script to inject the bridge. This should ensure that the bridge gets
  // injected before any other DOMContentLoaded or window.load event handler.
  webpage.evaluate(function() {
    /*jshint browser:true, devel:true */
    document.addEventListener('DOMContentLoaded', function() {
      alert('inject');
    }, false);
  });
};

// Run when the page has finished loading.
webpage.onLoadFinished = function(status) {
  // reset this handler to a no-op so further calls to onLoadFinished from iframes don't affect us
  webpage.onLoadFinished = function() { /* no-op */};

  // The window has loaded.
  sendMessage('onLoadFinished', status);
  if (status !== 'success') {
    // File loading failure.
    sendMessage('fail.load', url);
    if (options.screenshotOnFail) {
      takeScreenshot({
        name: ['page-at-timeout-', Date.now()].join(''),
        path: 'timeout'
      });
    }
    phantom.exit();
  }
};

// Actually load url.
webpage.open(url);
