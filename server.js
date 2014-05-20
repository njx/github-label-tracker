/*
 * Copyright (c) 2014 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */

/*jslint vars: true, plusplus: true, nomen: true, node: true, indent: 4, maxerr: 50 */

"use strict";

var Promise = require("bluebird"),
    fs = Promise.promisifyAll(require("fs")),
    tracker_utils = require("./lib/tracker-utils");

var config, log;

tracker_utils.readJSON("config.json")
    .then(function (contents) {
        config = contents;
        if (!config.repo || !config.labels || !config.storage || !config.api_key) {
            throw new Error("Must set repo, labels, storage, and api_key in config file");
        }
        return tracker_utils.updateFiles(config);
    })
    .then(function () {
        return tracker_utils.readJSON("storage/log.json");
    })
    .then(function (contents) {
        log = contents;
        console.log("Fetching updated labels");
        return tracker_utils.getCurrentLabels(config, log._timestamp);
    })
    .then(function (newLabels) {
        tracker_utils.updateLog(log, newLabels);
        return fs.writeFileAsync("storage/log.json", JSON.stringify(log, null, "  "));
    })
    .then(function () {
        return tracker_utils.storeFiles(config);
    })
    .then(function () {
        process.exit(0);
    })
    .catch(function (err) {
        console.error(err);
        process.exit(1);
    });
