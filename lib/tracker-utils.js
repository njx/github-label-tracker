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
    request = Promise.promisify(require("request")),
    child_process = Promise.promisifyAll(require("child_process")),
    _ = require("lodash");
    
exports.readFiles = function () {
    return Promise.all(
        ["config.json", "data/log.json"]
            .map(function (file) {
                return fs.readFileAsync(file)
                    .catch(function (err) {
                        // If the file doesn't exist, we just treat it as an empty object.
                        return "{}";
                    })
                    .then(JSON.parse);
            })
    );
};

exports.getCurrentLabels = function (config, sinceTimestamp) {
    var options = {
        url: "https://api.github.com/repos/" + config.repo + "/issues",
        qs: {
            access_token: config.api_key,
            since: new Date(sinceTimestamp).toISOString()
        },
        headers: {
            "User-Agent": "github-label-tracker"
        }
    };
    return request(options).spread(function (response, body) {
        if (response.statusCode !== 200) {
            throw new Error("Got bad status code: " + response.statusCode);
        }
        
        var issues = JSON.parse(body),
            labels = { _timestamp: 0 };
        issues.forEach(function (issue) {
            labels[issue.number] = _.intersection(_.pluck(issue.labels, "name"), config.labels);
            
            // Get the latest timestamp of all the returned labels, so we know where to start
            // checking for updates next time.
            var timestamp = Date.parse(issue.updated_at);
            if (timestamp > labels._timestamp) {
                labels._timestamp = timestamp;
            }
        });
        
        return labels;
    });
};

exports.updateLog = function (log, newLabels) {
    log._timestamp = newLabels._timestamp;

    Object.keys(newLabels).forEach(function (issue) {
        if (issue === "_timestamp") {
            return;
        }
        
        var oldLabelsForIssue = log[issue] && log[issue].labels || [],
            newLabelsForIssue = newLabels[issue],
            removedLabels = _.difference(oldLabelsForIssue, newLabelsForIssue),
            addedLabels = _.difference(newLabelsForIssue, oldLabelsForIssue);
        
        if (removedLabels.length || addedLabels.length) {
            log[issue] = log[issue] || {};
            log[issue][log._timestamp] = {
                removed: removedLabels.length ? removedLabels : undefined,
                added: addedLabels.length ? addedLabels : undefined
            };
        }
        log[issue].labels = newLabelsForIssue;
    });
};

exports.storeFiles = function (config) {
};