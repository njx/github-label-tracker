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

/*global expect, describe, it, beforeEach, afterEach, createSpy, waitsFor */

"use strict";

var stats = require("lib/stats"),
    _ = require("lodash");

describe("stats", function () {
    var issue,
        config,
        accum;

    beforeEach(function () {
        issue = {
            closedAt: 1411332475895,
            labelHistory: {
                changes: {
                    "1403795923000": {
                        "added": [
                            "Development"
                        ]
                    }
                }
            },
            type: "issue",
            labels: []
        };

        config = {
            developmentLabels: ["Development"],
            sizeLabels: ["MEDIUM"]
        };

        accum = new stats.Accumulator();
    });

    describe("normalizeToBeginningOfDay", function () {
        it("should convert a timestamp to a UTC timestamp at the begining of the day", function () {
            expect(stats.normalizeToBeginningOfDay(1411332475895)).toBe(1411257600000);
        });
    });
    
    describe("Accumulator", function () {
        it("should add a data point", function () {
            var a = new stats.Accumulator();
            a.add("fidgets", 1411332475895, 1);
            expect(a.data.fidgets[1411257600000]).toBe(1);
        });
    });
    
    describe("getAllLabelsSeen", function () {
        it("should find added and removed labels", function () {
            var labelHistory = {
                changes: {
                    1403795923000: {
                        added: ["Development"]
                    },
                    1403792921000: {
                        removed: ["Waiting"]
                    }
                }
            };
            
            var labels = stats.getAllLabelsSeen(labelHistory);
            expect(_.difference(labels, ["Development", "Waiting"])).toEqual([]);
        });
        
        it("shouldn't fail with no label history", function () {
            var labels = stats.getAllLabelsSeen();
            expect(labels).toEqual([]);
        });
    });
    
    describe("throughput", function () {
        it("should add one for an issue that was on the board and completed", function () {
            stats.throughput(config, issue, accum);
            expect(accum.data.throughput).toEqual({
                1411257600000: 1
            });
        });
        
        it("should also accumulate pull requests", function () {
            issue.type = "pull";
            stats.throughput(config, issue, accum);
            expect(accum.data.throughput).toEqual({
                1411257600000: 1
            });
        });
        
        it("should not accumulate data that was not on the board", function () {
            issue.labelHistory = {
                "1403795923000": {
                    "added": [
                        "Unknown"
                    ]
                }
            };
            stats.throughput(config, issue, accum);
            expect(accum.data.throughput).toBeUndefined();
        });
        
        it("should not accumulate issues that are not closed", function () {
            issue.closedAt = undefined;
            stats.throughput(config, issue, accum);
            expect(accum.data.throughput).toBeUndefined();
        });
        
        it("should accumulate issues by size label", function () {
            issue.labels = ["MEDIUM"];
            stats.throughput(config, issue, accum);
            expect(accum.data.throughputMEDIUM).toEqual({
                1411257600000: 1
            });
        });
    });
    
    describe("computeStats", function () {
        it("should include throughput", function () {
            var db = {
                issues: {
                    101: issue
                }
            },
                log = {
                    issueLabels: {
                        101: issue.labelHistory
                    }
                };
            
            delete issue.labelHistory;
            var data = stats.computeStats(config, db, log);
            expect(data.throughput).toEqual({
                1411257600000: 1
            });
        });
    });
});