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

var moment  = require("moment"),
    _       = require("lodash");

/**
 * Takes a timestamp and converts it to the beginning of the day in UTC.
 * 
 * @param {int} timestamp Could be anything Moment supports, but milliseconds is what's tested
 * @return {int} the normalized valueOf
 */
function normalizeToBeginningOfDay(timestamp) {
    return moment(timestamp).utc().startOf("day").valueOf();
}

/**
 * An Accumulator gathers the statistics that will wind up in the final stats file.
 */
function Accumulator() {
    this.data = {};
}

Accumulator.prototype = {
    /**
     * Adds the given value to the provided category for the date given.
     * 
     * @param {string} category Category for this data.
     * @param {int} date timestamp of the entry (will be normalized to beginning of day)
     * @param {int} value Count to add
     */
    add: function (category, date, value) {
        var categoryData = this.data[category];
        if (!categoryData) {
            categoryData = this.data[category] = {};
        }
        var day = normalizeToBeginningOfDay(date),
            dayData = categoryData[day];
        
        if (dayData === undefined) {
            dayData = 0;
        }
        
        dayData += value;
        categoryData[day] = dayData;
    }
};

/**
 * Looks at all of the labels that have appeared in a given issue's label history
 * (from the log).
 * 
 * @param {Object} labelHistory See the log.json file's issueLabels object for format.
 * @return {Array.<string>} set of labels seen
 */
function getAllLabelsSeen(labelHistory) {
    var result = [];
    if (!labelHistory || !labelHistory.changes) {
        return result;
    }
    
    var changes = labelHistory.changes;
    Object.keys(changes).forEach(function (timestamp) {
        var added = changes[timestamp].added,
            removed = changes[timestamp].removed;
        result = _.union(result, added, removed);
    });
    return result;
}

/**
 * Compute throughput statistics, grouped by size. It looks for all issues that have
 * appeared on the board (defined as having had one of the config.developmentLabels
 * at some point) and are now closed. The date the issue was closed is the date it is
 * done and counted for throughput.
 * 
 * @param {Object} config config.json values
 * @param {Object} issue information for one issue (from allIssues.json)
 * @param {Accumulator} accum The Accumulator for collection statistics.
 */
function throughput(config, issue, accum) {
    var labels = getAllLabelsSeen(issue.labelHistory);
    if (_.intersection(config.developmentLabels, labels).length > 0 && issue.closedAt) {
        var sizeLabels = _.intersection(config.sizeLabels, issue.labels);
        if (sizeLabels.length > 0) {
            if (sizeLabels.length > 1) {
                console.warn("Issue", issue.number, "has multiple size labels", sizeLabels);
            }
            accum.add("throughput" + sizeLabels[0], issue.closedAt, 1);
        } else {
            accum.add("throughput", issue.closedAt, 1);
        }
    }
}

/**
 * Computes all of the statistics.
 * 
 * @param {Object} config config.json values
 * @param {Object} db data from allIssues.json
 * @param {Object} log data from storage/log.json
 * @return {Object} accumulated data
 */
function computeStats(config, db, log) {
    var accum = new Accumulator(),
        issues = db.issues,
        issueIDs = Object.keys(issues);
    issueIDs.sort();
    issueIDs.forEach(function (id) {
        var issue = _.clone(issues[id]);
        issue.labelHistory = log.issueLabels[id];
        throughput(config, issue, accum);
    });
    return accum.data;
}

exports.Accumulator = Accumulator;
exports.normalizeToBeginningOfDay = normalizeToBeginningOfDay;
exports.getAllLabelsSeen = getAllLabelsSeen;
exports.throughput = throughput;

exports.computeStats = computeStats;