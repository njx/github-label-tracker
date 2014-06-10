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
    parse_link_header = require("parse-link-header"),
    _ = require("lodash");

var PR_STATE_NEW       = exports.PR_STATE_NEW       = "new",
    PR_STATE_IN_TRIAGE = exports.PR_STATE_IN_TRIAGE = "in triage",
    PR_STATE_TRIAGED   = exports.PR_STATE_TRIAGED   = "triaged",
    PR_STATE_IN_REVIEW = exports.PR_STATE_IN_REVIEW = "in review";
    
/** 
 * @private
 * Execute a shell command with the given options, logging it to the console.
 * @param {string} command The command to execute.
 * @param {Object} options The command options, as passed to `child_process.exec()`.
 * @return {Promise} A promise that's resolved when the command completes.
 */
function _logExec(command, options) {
    console.log("Running: " + command + " (in " + (options ? options.cwd : "cwd") + ")");
    return child_process.execAsync(command, options);
}

/**
 * Reads the given JSON file and resolve with the parsed content. If the file doesn't exist
 * or there's some other error reading it, returns an empty object.
 * @param {string} filename The file to read, either relative to the current directory or a full path.
 * @return {Promise} A promise that's resolved with the parsed JSON content.
 */
exports.readJSON = function (filename) {
    return fs.readFileAsync(filename)
        .catch(function (err) {
            // If the file doesn't exist, we just treat it as an empty object.
            return "{}";
        })
        .then(JSON.parse);
};

/**
 * Pulls the previous log from the storage repo specified in the config. Creates a local clone
 * of the repo in "storage" if it doesn't already exist.
 * @param {Object} config The config info. This function expects the `storage` parameter to be
 *      the name of the GitHub repo used for storing the label tracking info, in `user/repo` format.
 * @return {Promise} A promise that's resolved when the local repo has been updated.
 */
exports.updateFiles = function (config) {
    // Can't use the promisified version of exists() because it doesn't actually
    // take an errback (it passes the value as the first parameter).
    if (fs.existsSync("storage")) {
        return _logExec("git pull", { cwd: "storage" });
    } else {
        return _logExec("git clone https://github.com/" + config.storage + ".git storage");
    }
};

exports.requestGitHubData = function (config, sinceTimestamp, location, queryOptions, data, processorFunc) {
    var options = {
        url: "https://api.github.com/repos/" + config.repo + "/" + location,
        qs: _.extend({
            per_page: 100,
            access_token: config.api_key,
            since: sinceTimestamp ? new Date(sinceTimestamp).toISOString() : undefined
        }, queryOptions),
        headers: {
            "User-Agent": "github-label-tracker"
        }
    };

    function getNextPage() {
        return request(options).spread(function (response, body) {
            if (response.statusCode !== 200) {
                throw new Error("Got bad status code: " + response.statusCode);
            }

            var items = JSON.parse(body);
            items.forEach(function (item) {
                // Get the latest timestamp of all the returned labels, so we know where to start
                // checking for updates next time. (We don't just want to use a local timestamp,
                // since it might be out of sync with the GitHub timestamps.)
                var timestamp = Date.parse(item.updated_at);

                if (data.timestamp === undefined || timestamp > data.timestamp) {
                    data.timestamp = timestamp;
                }
                
                processorFunc(item);
            });

            if (response.headers && response.headers.link) {
                var parsedLinks = parse_link_header(response.headers.link);
                if (parsedLinks.next) {
                    options.qs.page = parsedLinks.next.page;
                    return getNextPage();
                }
            }
            return data;
        });
    }

    return getNextPage();
};


/**
 * Gets the issues and pull requests from the GitHub repo that have been updated since the given timestamp,
 * and pulls out the tracked labels for each issue. Handles the GitHub API's paging.
 * @param {Object} config The config object. This function expects:
 *      repo - string: the repo whose issues we're tracking, in `user/repo` format
 *      api_key - string: the GitHub personal API key to use
 *      labels - Array.<string>: array of labels we want to track
 *      firstRun - you can set this on first run to only retrieve the open issues
 * @param {number} sinceTimestamp The last time we ran, in Date.getTime() format.
 *      We'll only look at updates in GitHub that happened since that time.
 * @return {Promise} A promise that's resolved with the issue label and pull request info. This is an
 *      object with a "timestamp" property representing the last updated time of
 *      any issue that we retrieved, an "issueLabels" object whose keys are issue numbers
 *      and whose values are arrays of tracked labels currently applied to that issue and
 *      a pullRequests object whose keys are pull request numbers and whose values include
 *      title, assignee and state.
 */
exports.getLatestIssueInfo = function (config, sinceTimestamp) {
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
    
    var currentInfo = {
        timestamp: sinceTimestamp,
        issueLabels: {},
        pullRequests: {}
    };
    
    function getNextPage() {
        return request(options).spread(function (response, body) {
            if (response.statusCode !== 200) {
                throw new Error("Got bad status code: " + response.statusCode);
            }

            var issues = JSON.parse(body);
            issues.forEach(function (issue) {
                var issueLabels = currentInfo.issueLabels[issue.number] = _.intersection(_.pluck(issue.labels, "name"), config.labels);

                // Get the latest timestamp of all the returned labels, so we know where to start
                // checking for updates next time. (We don't just want to use a local timestamp,
                // since it might be out of sync with the GitHub timestamps.)
                var timestamp = Date.parse(issue.updated_at);
                if (currentInfo.timestamp === undefined || timestamp > currentInfo.timestamp) {
                    currentInfo.timestamp = timestamp;
                }
                
                if (issue.pull_request) {
                    var pr = currentInfo.pullRequests[issue.number] = {};
                    pr.title = issue.title;
                    pr.assignee = issue.assignee !== null ? issue.assignee.login : null;
                    pr.user = issue.user.login;
                    pr.created = Date.parse(issue.created_at);
                    if (pr.assignee) {
                        if (config.triageCompleteLabel && issueLabels.indexOf(config.triageCompleteLabel) > -1) {
                            pr.state = PR_STATE_IN_REVIEW;
                        } else {
                            pr.state = PR_STATE_IN_TRIAGE;
                        }
                    } else {
                        if (config.triageCompleteLabel && issueLabels.indexOf(config.triageCompleteLabel) > -1) {
                            pr.state = PR_STATE_TRIAGED;
                        } else {
                            pr.state = PR_STATE_NEW;
                        }
                    }
                }
            });

            if (response.headers && response.headers.link) {
                var parsedLinks = parse_link_header(response.headers.link);
                if (parsedLinks.next) {
                    options.qs.page = parsedLinks.next.page;
                    return getNextPage();
                }
            }
            return currentInfo;
        });
    }

    return getNextPage();
};

var pullNumber = /pull\/(\d+)/;

/**
 * Gets the comments from the GitHub repo that have been updated since the given timestamp,
 * and extracts the timestamps and creators for pull request comments. Handles the GitHub API's paging.
 * @param {Object} config The config object. This function expects:
 *      repo - string: the repo whose issues we're tracking, in `user/repo` format
 *      api_key - string: the GitHub personal API key to use
 *      firstRun - you can set this on first run to only retrieve a limited number of pages
 * @param {number} sinceTimestamp The last time we ran, in Date.getTime() format.
 *      We'll only look at updates in GitHub that happened since that time.
 * @return {Promise} A promise that's resolved with the comment info. This is an
 *      object with a "timestamp" property representing the last updated time of
 *      the most recent comment we retrieved and prCommentTimestamps which is an array
 *      of objects with `id` of the pull request, `user` who submitted the comment and `created`
 *      which is the timestamp the comment was created.
 */
exports.getLatestComments = function (config, sinceTimestamp) {
    var options = {
        url: "https://api.github.com/repos/" + config.repo + "/comments",
        qs: {
            per_page: 100,
            access_token: config.api_key,
            since: sinceTimestamp ? new Date(sinceTimestamp).toISOString() : undefined,
            sort: "created",
            direction: "desc"
        },
        headers: {
            "User-Agent": "github-label-tracker"
        }
    };

    var currentInfo = {
        timestamp: sinceTimestamp,
        prCommentTimestamps: []
    };

    function getNextPage() {
        return request(options).spread(function (response, body) {
            if (response.statusCode !== 200) {
                throw new Error("Got bad status code: " + response.statusCode);
            }

            var comments = JSON.parse(body);
            comments.forEach(function (comment) {
                // Get the latest timestamp of all the returned labels, so we know where to start
                // checking for updates next time. (We don't just want to use a local timestamp,
                // since it might be out of sync with the GitHub timestamps.)
                var timestamp = Date.parse(comment.updated_at);
                
                if (currentInfo.timestamp === undefined || timestamp > currentInfo.timestamp) {
                    currentInfo.timestamp = timestamp;
                }
                
                var match = pullNumber.exec(comment.html_url);
                if (match) {
                    currentInfo.prCommentTimestamps.push({
                        id: parseInt(match[1], 10),
                        user: comment.user.login,
                        created: Date.parse(comment.created_at)
                    });
                }
            });

            if (response.headers && response.headers.link) {
                var parsedLinks = parse_link_header(response.headers.link);
                if (parsedLinks.next) {
                    options.qs.page = parsedLinks.next.page;
                    return getNextPage();
                }
            }
            return currentInfo;
        });
    }

    return getNextPage();
};

/**
 * Updates the existing log in-place to find tracked labels that have been added to or
 * removed from issues in the given newLabels.
 * @param {Object} log The previous log, in the format described in the README.
 * @param {Object} newLabels The label updates to apply, as returned from `getCurrentLabels()`.
 * @return {boolean} True if the log was changed, false otherwise.
 */
exports.updateLog = function (log, newLabels) {
    var changed = false;
    
    if (log.timestamp !== newLabels.timestamp) {
        log.timestamp = newLabels.timestamp;
        changed = true;
    }
    
    log.issueLabels = log.issueLabels || {};

    // In theory, if the timestamps are the same, nothing should have
    // changed. But it doesn't hurt to check anyway in case there was
    // some race condition with the timestamps of issues updated at the
    // same time the last "since" query was executed.
    Object.keys(newLabels.issueLabels).forEach(function (issue) {
        var oldLabelsForIssue = (log.issueLabels[issue] && log.issueLabels[issue].current) || [],
            newLabelsForIssue = newLabels.issueLabels[issue],
            removedLabels = _.difference(oldLabelsForIssue, newLabelsForIssue),
            addedLabels = _.difference(newLabelsForIssue, oldLabelsForIssue);
        
        if (removedLabels.length || addedLabels.length) {
            var issueLabels = log.issueLabels[issue] || {},
                newChanges = {};
            if (removedLabels.length) {
                newChanges.removed = removedLabels;
            }
            if (addedLabels.length) {
                newChanges.added = addedLabels;
            }
            issueLabels.changes = issueLabels.changes || {};
            issueLabels.changes[log.timestamp] = newChanges;
            issueLabels.current = newLabelsForIssue;
            log.issueLabels[issue] = issueLabels;
            changed = true;
        }
    });
    
    return changed;
};

/**
 * Pushes log changes back up to the storage repo.
 * @param {Object} config The config object.
 * @return {Promise} A promise that's resolved when the changes have been pushed.
 */
exports.storeFiles = function (config) {
    var options = { cwd: "storage" };
    return _logExec("git add .", options)
        .then(function () {
            _logExec("git commit -m 'Update log'", options);
        })
        .then(function () {
            _logExec("git push origin head", options);
        });
};
