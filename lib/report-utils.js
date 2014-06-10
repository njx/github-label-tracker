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

/**
 * 
 */

var Promise       = require("bluebird"),
    fs            = require("fs"),
    path          = require("path"),
    _             = require("lodash"),
    tracker_utils = require("./tracker-utils");

// Constants for report status.
// These are also used as the labels on the report.
exports.RS_OVERDUE_AWAITING_REVIEW      = "Overdue, Awaiting Review";
exports.RS_OVERDUE_AWAITING_TRIAGE      = "Overdue, Awaiting Triage";
exports.RS_AWAITING_TRIAGE              = "Awaiting Triage";
exports.RS_AWAITING_REVIEW              = "Awaiting Review";
exports.RS_OVERDUE_IN_REVIEW            = "Overdue, In Review";
exports.RS_OVERDUE_IN_TRIAGE            = "Overdue, In Triage";
exports.RS_OVERDUE_FROM_USER_IN_REVIEW  = "Overdue from user, In Review";
exports.RS_OVERDUE_FROM_USER_IN_TRIAGE  = "Overdue from user, In Triage";
exports.RS_IN_REVIEW                    = "In Review";
exports.RS_IN_TRIAGE                    = "In Triage";

// Defines the sort order based on report statuses
var SECTION_SORT_ORDER = {};
SECTION_SORT_ORDER[exports.RS_OVERDUE_AWAITING_REVIEW]      = 0;
SECTION_SORT_ORDER[exports.RS_OVERDUE_AWAITING_TRIAGE]      = 1;
SECTION_SORT_ORDER[exports.RS_AWAITING_TRIAGE]              = 2;
SECTION_SORT_ORDER[exports.RS_AWAITING_REVIEW]              = 3;
SECTION_SORT_ORDER[exports.RS_OVERDUE_IN_REVIEW]            = 4;
SECTION_SORT_ORDER[exports.RS_OVERDUE_IN_TRIAGE]            = 5;
SECTION_SORT_ORDER[exports.RS_OVERDUE_FROM_USER_IN_REVIEW]  = 6;
SECTION_SORT_ORDER[exports.RS_OVERDUE_FROM_USER_IN_TRIAGE]  = 7;
SECTION_SORT_ORDER[exports.RS_IN_REVIEW]                    = 8;
SECTION_SORT_ORDER[exports.RS_IN_TRIAGE]                    = 9;

/**
 * Calculates when triage of a pull request was completed based on when the triage completed
 * label was added.
 * 
 * @param {string} prID Pull request ID number
 * @param {Object} issueLabels Mapping from pull request ID to issue labels (from the label tracker)
 * @param {string} triageCompleteLabel Label that represents that triage for a pull request has been completed.
 * @return {?number} Timestamp of the most recent addition to the triageCompleteLabel. Null if triage is not complete.
 */
exports.whenTriageCompleted = function (prID, issueLabels, triageCompleteLabel) {
    if (!issueLabels) {
        return null;
    }
    
    var labelInfo = issueLabels[prID];
    if (!labelInfo || !Array.isArray(labelInfo.current) || !labelInfo.changes || labelInfo.current.indexOf(triageCompleteLabel) === -1) {
        return null;
    }
    
    return _.chain(labelInfo.changes).keys().map(function (item) {
        var changeRecord = labelInfo.changes[item];
        if (changeRecord.added && changeRecord.added.indexOf(triageCompleteLabel) > -1) {
            return parseInt(item, 10);
        } else {
            return null;
        }
    }).max().value();
};

/**
 * Merges the triage complete information into the pull request data.
 * **Modifies the data in place**
 * 
 * @param {Object} pullRequests The pull request data from the log
 * @param {Object} issueLabels Mapping from pull request ID to issue labels (from the label tracker)
 * @param {string} triageCompleteLabel Label that represents that triage for a pull request has been completed.
 * @return {Object} The modified pullRequests
 */
exports.mergeTriageCompleted = function (pullRequests, issueLabels, triageCompleteLabel) {
    Object.keys(pullRequests).forEach(function (prID) {
        var pr = pullRequests[prID];
        pr.triageCompleted = exports.whenTriageCompleted(prID, issueLabels, triageCompleteLabel);
    });
    return pullRequests;
};

/**
 * For the "awaiting" states, calculate whether the PR is overdue and by how much (or how much time is left).
 * 
 * @param {number} currentTime Timestamp for report generation
 * @param {number} timeLimit How much time (in milliseconds) until it's considered overdue
 * @param {string} phase Which phase is this? (to properly assign the report state
 * @param {number} timestamp Timestamp being used for the comparison (when the state change in the PR occurred)
 * @return {{reportState: {string}, timer: {number}}} Current report state and timer value (amount overdue or remaining)
 */
function _waitingState(currentTime, timeLimit, phase, timestamp) {
    if (currentTime - timestamp > timeLimit) {
        return {
            reportState: exports["RS_OVERDUE_AWAITING_" + phase],
            timer: currentTime - timestamp - timeLimit
        };
    } else {
        return {
            reportState: exports["RS_AWAITING_" + phase],
            timer: timestamp - (currentTime - timeLimit)
        };
    }
}

/**
 * For the "in progress" states, calculate whether the PR is overdue and by how much (or how much time is left)
 * 
 * @param {number} currentTime Timestamp for report generation
 * @param {number} timeLimit How much time (in milliseconds) until it's considered overdue
 * @param {string} phase Which phase is this? (to properly assign the report state
 * @param {number} latestUserComment timestamp for most recent comment from the user who contributed the PR
 * @param {number} latestAssigneeComment timestamp for the most recent comment from the PR assignee
 * @param {number} created Timestamp when the PR was created
 * @param {number} triageCompleted Timestamp when triage was completed
 * @return {{reportState: {string}, timer: {number}}} Current report state and timer value (amount overdue or remaining)
 */
function _inState(currentTime, timeLimit, phase, latestUserComment, latestAssigneeComment, created, triageCompleted) {
    latestUserComment = latestUserComment || 0;
    latestAssigneeComment = latestAssigneeComment || 0;
    
    var events = [created, triageCompleted];
    if (latestAssigneeComment) {
        events.push(latestAssigneeComment);
        events.push(latestUserComment);
    }
    
    var latestEvent = _.max(events),
        assigneeCommentedLast = latestAssigneeComment > latestUserComment;
    
    if (currentTime - latestEvent > timeLimit) {
        var fromUser = assigneeCommentedLast ? "_FROM_USER" : "";
        return {
            reportState: exports["RS_OVERDUE" + fromUser + "_IN_" + phase],
            timer: currentTime - latestEvent - timeLimit
        };
    } else {
        return {
            reportState: exports["RS_IN_" + phase],
            timer: latestEvent - (currentTime - timeLimit)
        };
    }
}

/**
 * Figures out the current report state and timer value based on the data in the pull request.
 * 
 * @param {Object} pr Pull request data
 * @param {number} currentTime Time that the report is running
 * @param {number} timeLimit How much time (in milliseconds) before it's considered overdue
 * @return {{reportState: {string}, timer: {number}}} Current report state and timer value (amount overdue or remaining)
 */
exports.getReportState = function (pr, currentTime, timeLimit) {
    switch (pr.state) {
    case tracker_utils.PR_STATE_NEW:
        return _waitingState(currentTime, timeLimit, "TRIAGE", pr.created);
    case tracker_utils.PR_STATE_IN_TRIAGE:
        return _inState(currentTime, timeLimit, "TRIAGE", pr.latestUserComment, pr.latestAssigneeComment, pr.created, pr.triageCompleted);
    case tracker_utils.PR_STATE_TRIAGED:
        return _waitingState(currentTime, timeLimit, "REVIEW", pr.triageCompleted);
    case tracker_utils.PR_STATE_IN_REVIEW:
        return _inState(currentTime, timeLimit, "REVIEW", pr.latestUserComment, pr.latestAssigneeComment, pr.created, pr.triageCompleted);
    }
};

/**
 * Merges the report state information in with the pull request data from the log.
 * **Modifies the data in place** (don't save the log file)
 * 
 * @param {Object} pullRequests The pull request data from the log
 * @param {number} currentTime Time that the report is running
 * @param {number} timeLimit How much time (in milliseconds) before it's considered overdue
 * @return {Object} Modified pull requests object
 */
exports.mergeReportState = function (pullRequests, currentTime, timeLimit) {
    Object.keys(pullRequests).forEach(function (prID) {
        var pr = pullRequests[prID];
        pr.id = parseInt(prID, 10);
        _.extend(pr, exports.getReportState(pr, currentTime, timeLimit));
    });
    return pullRequests;
};

/**
 * Searches through the pull requests for ones that are considered "old" and marks them with `old = true`.
 * **Modifies the data in place**
 * 
 * @param {Object} pullRequests The pull request data from the log
 * @param {number} firstNewRequest 
 */
exports.markOldRequests = function (pullRequests, firstNewRequest) {
    _.values(pullRequests).forEach(function (pr) {
        if (pr.id < firstNewRequest) {
            pr.old = true;
        }
    });
    return pullRequests;
};

/**
 * Sorts the pull requests into sections to be displayed in the report.
 * 
 * @param {Object} pullRequests The pull request data from the log
 * @return {Array.<{section: {string}, pullRequests: {Array.<Object>}>} Sections in order, each section containing the name of the section in a `section` property and an array of pull request objects in `pullRequests`.
 */
exports.sortIntoSections = function (pullRequests) {
    var sections = {};
    
    // Create the section objects, breaking up the old and current.
    _.values(pullRequests).forEach(function (pr) {
        var reportState = pr.reportState;
        
        if (pr.old) {
            reportState = "Old " + reportState;
        }
        
        var section = sections[reportState];
        if (!section) {
            section = sections[reportState] = {
                section: reportState,
                pullRequests: []
            };
        }
        section.pullRequests.push(pr);
    });
    
    // Sort the pull requests by "timer". Descending for overdue (the later ones come at the top),
    // ascending when not overdue (so the ones with the least time left are shown at the top).
    _.values(sections).forEach(function (section) {
        var multiplier = section.section.indexOf("Overdue") > -1 ? -1 : 1;
        section.pullRequests.sort(function (pr1, pr2) {
            if (pr1.timer < pr2.timer) {
                return -1 * multiplier;
            } else if (pr1.timer > pr2.timer) {
                return multiplier;
            } else {
                return 0;
            }
        });
    });
    
    // Sort the sections based on the sort ordering provided by SECTION_SORT_ORDER.
    // Old sections come after the current ones.
    return Object.keys(sections).sort(function (s1, s2) {
        var s1IsOld = s1.substr(0, 3) === "Old",
            s2IsOld = s2.substr(0, 3) === "Old";
        
        if (s1IsOld && !s2IsOld) {
            return 1;
        } else if (!s1IsOld && s2IsOld) {
            return -1;
        }
        
        s1 = s1.replace("Old ", "");
        s2 = s2.replace("Old ", "");
        if (SECTION_SORT_ORDER[s1] < SECTION_SORT_ORDER[s2]) {
            return -1;
        } else if (SECTION_SORT_ORDER[s1] > SECTION_SORT_ORDER[s2]) {
            return 1;
        } else {
            throw new Error("Section sort orders were equal! " + s1 + " " + s2);
        }
        
    // Finally, return the ordered array of section objects.
    }).map(function (sectionName) {
        return sections[sectionName];
    });
};

/**
 * Generates statistics based on the data we've produced.
 * Currently:
 * * total: number of open pull requests
 * * overdue: number of overdue pull requests
 * * available: number of pull requests in "Awaiting" sections that are ready to be picked up for work
 * 
 * @param {Array.<Object>} sections Sections organized for report as generated by `sortIntoSections`
 * @return {{total: {number}, available: {number}, overdue: {number}} Statistics about the open requests
 */
exports.generateStatistics = function (sections) {
    var total = 0,
        overdue = 0,
        available = 0;
    
    sections.forEach(function (section) {
        var pullRequestCount = section.pullRequests.length;
        total += pullRequestCount;
        if (section.section.indexOf("Overdue") > -1) {
            overdue += pullRequestCount;
        }
        if (section.section.indexOf("Awaiting") > -1) {
            available += pullRequestCount;
        }
    });
    
    return {
        total: total,
        available: available,
        overdue: overdue
    };
};

// Constant used for default time limit. 8 days in milliseconds.
var EIGHT_DAYS = 8 * 24 * 60 * 60 * 1000;

/**
 * Generates the HTML report for pull requests.
 * 
 * @param {Object} config Configuration from config.json file
 * @param {Object} log Data collected from the track-labels script
 * @return {string} Formatted HTML report
 */
exports.generateReport = function (config, log) {
    var reportTime = new Date(),
        timeLimit = config.timeLimit || EIGHT_DAYS;
    
    exports.mergeTriageCompleted(log.pullRequests, log.issueLabels, config.triageCompleteLabel);
    exports.mergeReportState(log.pullRequests, reportTime.getTime(), timeLimit);
    if (config.oldPullRequests) {
        exports.markOldRequests(log.pullRequests, config.oldPullRequests);
    }
    var sections = exports.sortIntoSections(log.pullRequests);
    
    var data = {
        reportTime: reportTime,
        sections: sections,
        config: config,
        stats: exports.generateStatistics(sections)
    };
    var templateText = fs.readFileSync(path.join(path.dirname(module.filename), "templates", "pr-report.tmpl"), "utf8");
    return _.template(templateText, data);
};