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

"use strict";

var Promise = require("bluebird"),
    fs = Promise.promisifyAll(require("fs")),
    tracker_utils = require("./lib/tracker-utils");

Promise.longStackTraces();

var config;

// Read the configuration file
tracker_utils.readJSON("config.json")
    .then(function (contents) {
        config = contents;
        if (!config.repo || !config.labels || !config.storage || !config.api_key) {
            throw new Error("Must set repo, labels, storage, and api_key in config file");
        }
        // Pull the previous log from the storage repo
        return tracker_utils.updateFiles(config);
    })
    .then(function () {
        return tracker_utils.readJSON("storage/log.json");
    })
    .then(function (log) {
        return Promise.props({
            log: log,
            latestIssues: tracker_utils.getLatestIssueInfo(config, log.timestamp || config.initial_timestamp),
            latestComments: tracker_utils.getLatestComments(config, log.timestamp || config.initial_timestamp)
        });
    })
    .then(function (data) {
        // Update the label changes in the log based on the new labels
        if (!tracker_utils.updateLog(data.log, data.latestIssues, data.latestComments)) {
            console.log("No issues changed - exiting");
            process.exit(0);
        }
        return fs.writeFileAsync("storage/log.json", JSON.stringify(data.log, null, "  "));
    })
    .then(function () {
        // Push the changes up to the storage repo
        return tracker_utils.storeFiles(config);
    })
    .then(function () {
        process.exit(0);
    })
    .catch(function (err) {
        console.error(err);
        console.error(err.stack);
        process.exit(1);
    });
