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

/**
 * Generic function to handle requesting data from GitHub and paging through the data.
 * @param {Object} config The config object. This function expects:
 *      repo - string: the repo whose issues we're tracking, in `user/repo` format
 *      api_key - string: the GitHub personal API key to use
 *      labels - Array.<string>: array of labels we want to track
 * @param {number} sinceTimestamp The last time we ran, in Date.getTime() format.
 *      We'll only look at updates in GitHub that happened since that time.
 * @param {string} location The last part of the URL for GitHub (issues or comments)
 * @param {object} queryOptions additional options to send to GitHub
 * @param {object} data Data object to return. The `timestamp` property is automatically managed
 * @param {function} processorFunc function that operates on each item returned from GitHub. It is passed the item and the timestamp. If the function returns true, that means to stop processing.
 * @return {Promise} A promise that's resolved with the data object
 */
var requestGitHubData = function (config, sinceTimestamp, location, queryOptions, data, processorFunc) {
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
                // Get the latest timestamp of all the returned data, so we know where to start
                // checking for updates next time. (We don't just want to use a local timestamp,
                // since it might be out of sync with the GitHub timestamps.)
                var timestamp = Date.parse(item.updated_at);

                if (data.timestamp === undefined || timestamp > data.timestamp) {
                    data.timestamp = timestamp;
                }
                
                processorFunc(item, timestamp);
            });

            if (response.headers && response.headers.link) {
                var parsedLinks = parse_link_header(response.headers.link);
                if (parsedLinks.next) {
                    options.qs.page = parsedLinks.next.page;
                    return getNextPage();
                }
            }
            if (response.headers && response.headers["x-ratelimit-remaining"]) {
                console.log("Rate Limit", response.headers["x-ratelimit-remaining"]);
            }
            return data;
        });
    }

    return getNextPage();
};

/**
 * Takes the raw GitHub version of an issue and reformats it into our format for storage.
 * 
 * @param {Object} issue Issue/pull request data from GitHub
 * @return {Object} issue/pull request data in our form for storage
 */
exports.reformatIssue = function reformatIssue(issue) {
    var copy = _.clone(issue);
    delete copy.url;
    delete copy.labels_url;
    delete copy.comments_url;
    delete copy.events_url;
    delete copy.id;
    delete copy.html_url;
    copy.user = copy.user.login;
    copy.labels = _.pluck(copy.labels, "name");
    delete copy.locked;
    delete copy.body;
    if (copy.pull_request) {
        copy.type = "pull";
        delete copy.pull_request;
    } else {
        copy.type = "issue";
    }
    if (copy.milestone) {
        copy.milestone = copy.milestone.title;
    }
    if (copy.assignee) {
        copy.assignee = copy.assignee.login;
    }
    copy.createdAt = Date.parse(copy.created_at);
    delete copy.created_at;
    copy.updatedAt = Date.parse(copy.updated_at);
    delete copy.updated_at;
    if (copy.closed_at) {
        copy.closedAt = Date.parse(copy.closed_at);
    } else {
        copy.closedAt = null;
    }
    delete copy.closed_at;

    return copy;
};



/**
 * Gets the issues and pull requests from the GitHub repo that have been updated since the given timestamp,
 * and pulls out the tracked labels for each issue. Handles the GitHub API's paging.
 * @param {Object} config The config object. This function expects:
 *      repo - string: the repo whose issues we're tracking, in `user/repo` format
 *      api_key - string: the GitHub personal API key to use
 *      labels - Array.<string>: array of labels we want to track
 *      firstRun - you can set this on first run to only retrieve the open issues
 * @param {Object} db - current offline data
 * @return {Promise} A promise that's resolved with the updated database.
 */
exports.getLatestIssueInfo = function (config, db) {
    db.latestUpdates = {
        issues: [],
        pulls: []
    };
    
    return requestGitHubData(config, db.timestamp, "issues", {
        state: "all"
    }, db, function (issue) {
        var ourIssue = exports.reformatIssue(issue);
        db.issues[issue.number] = ourIssue;
        if (ourIssue.type === "pull") {
            db.latestUpdates.pulls.push(issue.number);
        } else {
            db.latestUpdates.issues.push(issue.number);
        }
    });
};

// Regular expression to get the pull request number out of the URL for a comment.
// Comments don't have a separate field for their associated issue ID or a better way
// to determine that the issue is a pull request.
var pullNumber = /pull\/(\d+)/;

// Constant for 6 months (the oldest comments we take for firstRun)
var SIX_MONTHS = 6 * 30 * 24 * 3600 * 1000;

/**
 * Gets the comments from the GitHub repo that have been updated since the given timestamp,
 * and extracts the timestamps and creators for pull request comments. Handles the GitHub API's paging.
 * @param {Object} config The config object. This function expects:
 *      repo - string: the repo whose issues we're tracking, in `user/repo` format
 *      api_key - string: the GitHub personal API key to use
 *      firstRun - you can set this on first run to only retrieve comments for the six months
 * @param {number} sinceTimestamp The last time we ran, in Date.getTime() format.
 *      We'll only look at updates in GitHub that happened since that time.
 * @return {Promise} A promise that's resolved with the comment info. This is an
 *      object with a "timestamp" property representing the last updated time of
 *      the most recent comment we retrieved and prCommentTimestamps which is an array
 *      of objects with `id` of the pull request, `user` who submitted the comment and `created`
 *      which is the timestamp the comment was created.
 */
exports.getLatestComments = function (config, sinceTimestamp) {
    var currentInfo = {
        timestamp: sinceTimestamp,
        prCommentTimestamps: []
    };

    return requestGitHubData(config, sinceTimestamp, "issues/comments", {
        sort: "created",
        direction: "desc"
    }, currentInfo, function (comment, timestamp) {
        if (config.firstRun && (new Date() - timestamp > SIX_MONTHS)) {
            return true;
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
};

/**
 * Updates the existing log in-place to find tracked labels that have been added to or
 * removed from issues in the given newLabels.
 * @param {Object} config the configuration with "labels" as the list of labels to track
 * @param {Object} log The previous log, in the format described in the README.
 * @param {Object} db Master database of issue information
 * @param {Object} latestComments Pull request comment info from `getLatestComments()`
 */
exports.updateLog = function (config, log, db, latestComments) {
    var newTimestamp = db.timestamp;
    if (latestComments && latestComments.timestamp > db.timestamp) {
        newTimestamp = latestComments.timestamp;
    }
    
    log.timestamp = newTimestamp;
    
    log.issueLabels = log.issueLabels || {};

    // In theory, if the timestamps are the same, nothing should have
    // changed. But it doesn't hurt to check anyway in case there was
    // some race condition with the timestamps of issues updated at the
    // same time the last "since" query was executed.
    var updates = _.union(db.latestUpdates.issues, db.latestUpdates.pulls);
    updates.forEach(function (issueNumber) {
        var oldLabelsForIssue = (log.issueLabels[issueNumber] && log.issueLabels[issueNumber].current) || [],
            newLabelsForIssue = _.intersection(db.issues[issueNumber].labels, config.labels),
            removedLabels = _.difference(oldLabelsForIssue, newLabelsForIssue),
            addedLabels = _.difference(newLabelsForIssue, oldLabelsForIssue);
        
        if (removedLabels.length || addedLabels.length) {
            var issueLabels = log.issueLabels[issueNumber] || {},
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
            log.issueLabels[issueNumber] = issueLabels;
        }
    });
    
    log.pullRequests = log.pullRequests || {};
    
    db.latestUpdates.pulls.forEach(function (prID) {
        var existingPR = log.pullRequests[prID],
            newPR = db.issues[prID];
        
        if (newPR.state === "closed") {
            if (existingPR) {
                delete log.pullRequests[prID];
            }
            return;
        }
        
        if (!existingPR) {
            existingPR = log.pullRequests[prID] = {};
        }
    });
    
    // Gather up the comment information
    if (latestComments && latestComments.prCommentTimestamps) {
        latestComments.prCommentTimestamps.forEach(function (comment) {
            var pr = log.pullRequests[comment.id],
                issue = db.issues[comment.id];
            if (pr) {
                if (comment.user === issue.assignee) {
                    if (!pr.latestAssigneeComment || pr.latestAssigneeComment < comment.created) {
                        pr.latestAssigneeComment = comment.created;
                    }
                } else if (comment.user === issue.user) {
                    if (!pr.latestUserComment || pr.latestUserComment < comment.created) {
                        pr.latestUserComment = comment.created;
                    }
                }
            }
        });
    }
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
