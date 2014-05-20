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
    request = Promise.promisify(require("request")),
    child_process = Promise.promisifyAll(require("child_process")),
    parse_link_header = require("parse-link-header"),
    _ = require("lodash");
    
function logExec(command, options) {
    console.log("Running: " + command + " (in " + (options ? options.cwd : "cwd") + ")");
    return child_process.execAsync(command, options);
}

exports.readJSON = function (filename) {
    return fs.readFileAsync(filename)
        .catch(function (err) {
            // If the file doesn't exist, we just treat it as an empty object.
            return "{}";
        })
        .then(JSON.parse);
};

exports.updateFiles = function (config) {
    // Can't use the promisified version of exists() because it doesn't actually
    // take an errback (it passes the value as the first parameter).
    return new Promise(function (resolve) {
        if (fs.existsSync("storage")) {
            resolve();
        } else {
            resolve(logExec("git clone https://github.com/" + config.storage + ".git storage"));
        }
    }).then(function () {
        logExec("git pull", { cwd: "storage" });
    });
};

exports.getCurrentLabels = function (config, sinceTimestamp) {
    var options = {
        url: "https://api.github.com/repos/" + config.repo + "/issues",
        qs: {
            per_page: 100,
            access_token: config.api_key,
            since: sinceTimestamp ? new Date(sinceTimestamp).toISOString() : undefined,
            state: "all" // need to get closed issues too since their labels might have changed before they were closed
        },
        headers: {
            "User-Agent": "github-label-tracker"
        }
    };
    
    var labels = { _timestamp: sinceTimestamp };
    
    function getNextPage() {
        return request(options).spread(function (response, body) {
            if (response.statusCode !== 200) {
                throw new Error("Got bad status code: " + response.statusCode);
            }

            var issues = JSON.parse(body);
            issues.forEach(function (issue) {
                labels[issue.number] = _.intersection(_.pluck(issue.labels, "name"), config.labels);

                // Get the latest timestamp of all the returned labels, so we know where to start
                // checking for updates next time. (We don't just want to use a local timestamp,
                // since it might be out of sync with the GitHub timestamps.)
                var timestamp = Date.parse(issue.updated_at);
                if (labels._timestamp === undefined || timestamp > labels._timestamp) {
                    labels._timestamp = timestamp;
                }
            });

            if (response.headers && response.headers.link) {
                var parsedLinks = parse_link_header(response.headers.link);
                if (parsedLinks.next) {
                    options.qs.page = parsedLinks.next.page;
                    return getNextPage();
                }
            }
            return labels;
        });
    }

    return getNextPage();
};

exports.updateLog = function (log, newLabels) {
    var changed = false;
    
    if (log._timestamp !== newLabels._timestamp) {
        log._timestamp = newLabels._timestamp;
        changed = true;
    }

    // In theory, if the timestamps are the same, nothing should have
    // changed. But it doesn't hurt to check anyway in case there was
    // some race condition with the timestamps of issues updated at the
    // same time the last "since" query was executed.
    Object.keys(newLabels).forEach(function (issue) {
        if (issue === "_timestamp") {
            return;
        }
        
        var oldLabelsForIssue = (log[issue] && log[issue].labels) || [],
            newLabelsForIssue = newLabels[issue],
            removedLabels = _.difference(oldLabelsForIssue, newLabelsForIssue),
            addedLabels = _.difference(newLabelsForIssue, oldLabelsForIssue);
        
        if (removedLabels.length || addedLabels.length) {
            log[issue] = log[issue] || {};
            log[issue][log._timestamp] = {
                removed: removedLabels.length ? removedLabels : undefined,
                added: addedLabels.length ? addedLabels : undefined
            };
            log[issue].labels = newLabelsForIssue;
            changed = true;
        }
    });
    
    return changed;
};

exports.storeFiles = function (config) {
    var options = { cwd: "storage" };
    return logExec("git add .", options)
        .then(function () {
            logExec("git commit -m 'Update log'", options)
        })
        .then(function () {
            logExec("git push origin head", options)
        });
};