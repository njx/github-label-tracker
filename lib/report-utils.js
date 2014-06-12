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
    fs = require("fs"),
    path = require("path"),
    _ = require("lodash"),
    tracker_utils = require("./tracker-utils");

exports.RS_OVERDUE_AWAITING_REVIEW = "Overdue, Awaiting Review";
exports.RS_OVERDUE_AWAITING_TRIAGE = "Overdue, Awaiting Triage";
exports.RS_AWAITING_TRIAGE = "Awaiting Triage";
exports.RS_AWAITING_REVIEW = "Awaiting Review";
exports.RS_OVERDUE_IN_REVIEW = "Overdue, In Review";
exports.RS_OVERDUE_IN_TRIAGE = "Overdue, In Triage";
exports.RS_OVERDUE_FROM_USER_IN_REVIEW = "Overdue from user, In Review";
exports.RS_OVERDUE_FROM_USER_IN_TRIAGE = "Overdue from user, In Triage";
exports.RS_IN_REVIEW = "In Review";
exports.RS_IN_TRIAGE = "In Triage";

var SECTION_SORT_ORDER = {};
SECTION_SORT_ORDER[exports.RS_OVERDUE_AWAITING_REVIEW] = 0;
SECTION_SORT_ORDER[exports.RS_OVERDUE_AWAITING_TRIAGE] = 1;
SECTION_SORT_ORDER[exports.RS_AWAITING_TRIAGE] = 2;
SECTION_SORT_ORDER[exports.RS_AWAITING_REVIEW] = 3;
SECTION_SORT_ORDER[exports.RS_OVERDUE_IN_REVIEW] = 4;
SECTION_SORT_ORDER[exports.RS_OVERDUE_IN_TRIAGE] = 5;
SECTION_SORT_ORDER[exports.RS_OVERDUE_FROM_USER_IN_REVIEW] = 6;
SECTION_SORT_ORDER[exports.RS_OVERDUE_FROM_USER_IN_TRIAGE] = 7;
SECTION_SORT_ORDER[exports.RS_IN_REVIEW] = 8;
SECTION_SORT_ORDER[exports.RS_IN_TRIAGE] = 9;

/**
 * Calculates when triage of a pull request was completed.
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

exports.mergeTriageCompleted = function (pullRequests, issueLabels, triageCompleteLabel) {
    Object.keys(pullRequests).forEach(function (prID) {
        var pr = pullRequests[prID];
        pr.triageCompleted = exports.whenTriageCompleted(prID, issueLabels, triageCompleteLabel);
    });
    return pullRequests;
};

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

function _inState(currentTime, timeLimit, phase, latestUserComment, latestAssigneeComment, created) {
    if ((!latestUserComment && !latestAssigneeComment) || !latestAssigneeComment) {
        if (currentTime - created > timeLimit) {
            return {
                reportState: exports["RS_OVERDUE_IN_" + phase],
                timer: currentTime - created - timeLimit
            };
        } else {
            return {
                reportState: exports["RS_IN_" + phase],
                timer: created - (currentTime - timeLimit)
            };
        }
    } else if (!latestUserComment && (currentTime - latestAssigneeComment < timeLimit || currentTime - created < timeLimit)) {
        return {
            reportState: exports["RS_IN_" + phase],
            timer: latestAssigneeComment - (currentTime - timeLimit)
        };
    } else if (latestAssigneeComment < latestUserComment && currentTime - latestUserComment > timeLimit) {
        return {
            reportState: exports["RS_OVERDUE_IN_" + phase],
            timer: currentTime - latestUserComment - timeLimit
        };
    } else if (!latestUserComment || (latestUserComment < latestAssigneeComment && currentTime - latestAssigneeComment > timeLimit)) {
        return {
            reportState: exports["RS_OVERDUE_FROM_USER_IN_" + phase],
            timer: currentTime - latestAssigneeComment - timeLimit
        };
    } else {
        return {
            reportState: exports["RS_IN_" + phase],
            timer: _.max([latestAssigneeComment, latestUserComment]) - (currentTime - timeLimit)
        };
    }
}

exports.getReportState = function (pr, currentTime, timeLimit) {
    switch (pr.state) {
    case tracker_utils.PR_STATE_NEW:
        return _waitingState(currentTime, timeLimit, "TRIAGE", pr.created);
    case tracker_utils.PR_STATE_IN_TRIAGE:
        return _inState(currentTime, timeLimit, "TRIAGE", pr.latestUserComment, pr.latestAssigneeComment, pr.created);
    case tracker_utils.PR_STATE_TRIAGED:
        return _waitingState(currentTime, timeLimit, "REVIEW", pr.triageCompleted);
    case tracker_utils.PR_STATE_IN_REVIEW:
        return _inState(currentTime, timeLimit, "REVIEW", pr.latestUserComment, pr.latestAssigneeComment, pr.created);
    }
};

exports.mergeReportState = function (pullRequests, currentTime, timeLimit) {
    Object.keys(pullRequests).forEach(function (prID) {
        var pr = pullRequests[prID];
        pr.id = parseInt(prID, 10);
        _.extend(pr, exports.getReportState(pr, currentTime, timeLimit));
    });
    return pullRequests;
};

exports.markOldRequests = function (pullRequests, firstNewRequest) {
    _.values(pullRequests).forEach(function (pr) {
        if (pr.id < firstNewRequest) {
            pr.old = true;
        }
    });
    return pullRequests;
};

exports.sortIntoSections = function (pullRequests) {
    var sections = {};
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
    }).map(function (sectionName) {
        return sections[sectionName];
    });
};

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

var EIGHT_DAYS = 8 * 24 * 60 * 60 * 1000;

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