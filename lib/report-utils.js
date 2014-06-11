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

exports.readTemplate = function () {
};

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

function _inState(currentTime, timeLimit, phase, latestUserComment, latestAssigneeComment) {
    if (latestAssigneeComment < latestUserComment && currentTime - latestUserComment > timeLimit) {
        return {
            reportState: exports["RS_OVERDUE_IN_" + phase],
            timer: currentTime - latestUserComment - timeLimit
        };
    } else if (latestUserComment < latestAssigneeComment && currentTime - latestAssigneeComment > timeLimit) {
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
        return _inState(currentTime, timeLimit, "TRIAGE", pr.latestUserComment, pr.latestAssigneeComment);
    case tracker_utils.PR_STATE_TRIAGED:
        return _waitingState(currentTime, timeLimit, "REVIEW", pr.triageCompleted);
    case tracker_utils.PR_STATE_IN_REVIEW:
        return _inState(currentTime, timeLimit, "REVIEW", pr.latestUserComment, pr.latestAssigneeComment);
    }
};