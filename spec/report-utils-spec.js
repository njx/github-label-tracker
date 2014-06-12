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

var rewire = require("rewire"),
    _ = require("lodash"),
    Promise = require("bluebird"),
    report_utils = require("../lib/report-utils"),
    tracker_utils = require("../lib/tracker-utils");

describe("whenTriageCompleted", function () {
    it("should return null if there's no data", function () {
        expect(report_utils.whenTriageCompleted(1000, undefined, "PR Triage Complete")).toBeNull();
    });
    
    it("should return null if the PR is not complete", function () {
        var issueLabels = {
            1000: {
                current: []
            }
        };
        expect(report_utils.whenTriageCompleted(1000, issueLabels, "PR Triage Complete")).toBeNull();
    });
    
    it("should return the latest timestamp when the completion label was added", function () {
        var issueLabels = {
            1000: {
                current: ["PR Triage Complete"],
                changes: {
                    9999: {
                        added: ["PR Triage Complete"]
                    },
                    8888: {
                        removed: ["PR Triage Complete"]
                    },
                    7777: {
                        added: ["PR Triage Complete"]
                    }
                }
            }
        };
        expect(report_utils.whenTriageCompleted(1000, issueLabels, "PR Triage Complete")).toBe(9999);
    });
});

describe("mergeTriageCompleted", function () {
    it("should merge the triage completed values into the PR information", function () {
        var issueLabels = {
            1000: {
                current: ["PR Triage Complete"],
                changes: {
                    9999: {
                        added: ["PR Triage Complete"]
                    }
                }
            },
            1001: {
                current: []
            },
            1002: {
                current: ["PR Triage Complete"],
                changes: {
                    5322: {
                        added: ["PR Triage Complete"]
                    }
                }
            }
        },
            pullRequests = {
                1002: {},
                1001: {},
                1000: {}
            };
        
        var result = report_utils.mergeTriageCompleted(pullRequests, issueLabels, "PR Triage Complete");
        expect(result).toEqual({
            1000: {
                triageCompleted: 9999
            },
            1001: {
                triageCompleted: null
            },
            1002: {
                triageCompleted: 5322
            }
        });
    });
});

describe("getReportState", function () {
    it("should identify awaiting triage", function () {
        var pr = {
            created: 100,
            state: tracker_utils.PR_STATE_NEW
        };
        expect(report_utils.getReportState(pr, 105, 100)).toEqual({
            reportState: report_utils.RS_AWAITING_TRIAGE,
            timer: 95
        });
        expect(report_utils.getReportState(pr, 110, 100)).toEqual({
            reportState: report_utils.RS_AWAITING_TRIAGE,
            timer: 90
        });
    });
    
    it("should identify overdue awaiting triage", function () {
        var pr = {
            created: 100,
            state: tracker_utils.PR_STATE_NEW
        };
        
        expect(report_utils.getReportState(pr, 205, 100)).toEqual({
            reportState: report_utils.RS_OVERDUE_AWAITING_TRIAGE,
            timer: 5
        });
        
        expect(report_utils.getReportState(pr, 210, 100)).toEqual({
            reportState: report_utils.RS_OVERDUE_AWAITING_TRIAGE,
            timer: 10
        });
    });
    
    it("should identify overdue in triage", function () {
        var pr = {
            state: tracker_utils.PR_STATE_IN_TRIAGE,
            latestAssigneeComment: 100,
            latestUserComment: 200
        };
        
        expect(report_utils.getReportState(pr, 350, 100)).toEqual({
            reportState: report_utils.RS_OVERDUE_IN_TRIAGE,
            timer: 50
        });
        
        expect(report_utils.getReportState(pr, 375, 100)).toEqual({
            reportState: report_utils.RS_OVERDUE_IN_TRIAGE,
            timer: 75
        });
    });
    
    it("should identify overdue in triage with no comments", function () {
        var pr = {
            state: tracker_utils.PR_STATE_IN_TRIAGE,
            created: 100
        };
        
        expect(report_utils.getReportState(pr, 250, 100)).toEqual({
            reportState: report_utils.RS_OVERDUE_IN_TRIAGE,
            timer: 50
        });
    });
    
    it("should identify overdue in triage with no assignee comments", function () {
        var pr = {
            state: tracker_utils.PR_STATE_IN_TRIAGE,
            created: 100,
            latestUserComment: 150
        };
        
        expect(report_utils.getReportState(pr, 201, 100)).toEqual({
            reportState: report_utils.RS_OVERDUE_IN_TRIAGE,
            timer: 1
        });
    });
    
    it("should identify overdue from user in triage with no user comments", function () {
        var pr = {
            state: tracker_utils.PR_STATE_IN_TRIAGE,
            created: 100,
            latestAssigneeComment: 125
        };
        
        expect(report_utils.getReportState(pr, 250, 100)).toEqual({
            reportState: report_utils.RS_OVERDUE_FROM_USER_IN_TRIAGE,
            timer: 25
        });
    });
    
    it("should identify in triage with no user comments", function () {
        var pr = {
            state: tracker_utils.PR_STATE_IN_TRIAGE,
            created: 100,
            latestAssigneeComment: 125
        };

        expect(report_utils.getReportState(pr, 199, 100)).toEqual({
            reportState: report_utils.RS_IN_TRIAGE,
            timer: 26
        });
    });
    
    it("should identify user overdue in triage", function () {
        var pr = {
            state: tracker_utils.PR_STATE_IN_TRIAGE,
            latestAssigneeComment: 200,
            latestUserComment: 100
        };

        expect(report_utils.getReportState(pr, 350, 100)).toEqual({
            reportState: report_utils.RS_OVERDUE_FROM_USER_IN_TRIAGE,
            timer: 50
        });

        expect(report_utils.getReportState(pr, 375, 100)).toEqual({
            reportState: report_utils.RS_OVERDUE_FROM_USER_IN_TRIAGE,
            timer: 75
        });
    });
    
    it("should identify in triage", function () {
        var pr = {
            state: tracker_utils.PR_STATE_IN_TRIAGE,
            latestAssigneeComment: 200,
            latestUserComment: 100
        };

        expect(report_utils.getReportState(pr, 250, 100)).toEqual({
            reportState: report_utils.RS_IN_TRIAGE,
            timer: 50
        });

        expect(report_utils.getReportState(pr, 275, 100)).toEqual({
            reportState: report_utils.RS_IN_TRIAGE,
            timer: 25
        });
        
        // Flip the comment times and get the same result
        pr = {
            state: tracker_utils.PR_STATE_IN_TRIAGE,
            latestAssigneeComment: 100,
            latestUserComment: 200
        };
        
        expect(report_utils.getReportState(pr, 250, 100)).toEqual({
            reportState: report_utils.RS_IN_TRIAGE,
            timer: 50
        });

        expect(report_utils.getReportState(pr, 275, 100)).toEqual({
            reportState: report_utils.RS_IN_TRIAGE,
            timer: 25
        });
    });
    
    it("should identify overdue awaiting review", function () {
        var pr = {
            state: tracker_utils.PR_STATE_TRIAGED,
            triageCompleted: 100
        };
        
        expect(report_utils.getReportState(pr, 250, 100)).toEqual({
            reportState: report_utils.RS_OVERDUE_AWAITING_REVIEW,
            timer: 50
        });
        
        expect(report_utils.getReportState(pr, 225, 100)).toEqual({
            reportState: report_utils.RS_OVERDUE_AWAITING_REVIEW,
            timer: 25
        });
    });
    
    it("should identify awaiting review", function () {
        var pr = {
            state: tracker_utils.PR_STATE_TRIAGED,
            triageCompleted: 100
        };
        
        expect(report_utils.getReportState(pr, 150, 100)).toEqual({
            reportState: report_utils.RS_AWAITING_REVIEW,
            timer: 50
        });

        expect(report_utils.getReportState(pr, 175, 100)).toEqual({
            reportState: report_utils.RS_AWAITING_REVIEW,
            timer: 25
        });
    });
    
    it("should identify overdue in review", function () {
        var pr = {
            state: tracker_utils.PR_STATE_IN_REVIEW,
            latestAssigneeComment: 100,
            latestUserComment: 200
        };

        expect(report_utils.getReportState(pr, 350, 100)).toEqual({
            reportState: report_utils.RS_OVERDUE_IN_REVIEW,
            timer: 50
        });

        expect(report_utils.getReportState(pr, 375, 100)).toEqual({
            reportState: report_utils.RS_OVERDUE_IN_REVIEW,
            timer: 75
        });
    });

    it("should identify user overdue in review", function () {
        var pr = {
            state: tracker_utils.PR_STATE_IN_REVIEW,
            latestAssigneeComment: 200,
            latestUserComment: 100
        };

        expect(report_utils.getReportState(pr, 350, 100)).toEqual({
            reportState: report_utils.RS_OVERDUE_FROM_USER_IN_REVIEW,
            timer: 50
        });

        expect(report_utils.getReportState(pr, 375, 100)).toEqual({
            reportState: report_utils.RS_OVERDUE_FROM_USER_IN_REVIEW,
            timer: 75
        });
    });

    it("should identify in review", function () {
        var pr = {
            state: tracker_utils.PR_STATE_IN_REVIEW,
            latestAssigneeComment: 200,
            latestUserComment: 100
        };

        expect(report_utils.getReportState(pr, 250, 100)).toEqual({
            reportState: report_utils.RS_IN_REVIEW,
            timer: 50
        });

        expect(report_utils.getReportState(pr, 275, 100)).toEqual({
            reportState: report_utils.RS_IN_REVIEW,
            timer: 25
        });

        // Flip the comment times and get the same result
        pr = {
            state: tracker_utils.PR_STATE_IN_REVIEW,
            latestAssigneeComment: 100,
            latestUserComment: 200
        };

        expect(report_utils.getReportState(pr, 250, 100)).toEqual({
            reportState: report_utils.RS_IN_REVIEW,
            timer: 50
        });

        expect(report_utils.getReportState(pr, 275, 100)).toEqual({
            reportState: report_utils.RS_IN_REVIEW,
            timer: 25
        });
    });
});

describe("mergeReportState", function () {
    it("should merge report state into the pull request data", function () {
        var pullRequests = {
            1000: {
                state: tracker_utils.PR_STATE_NEW,
                created: 100
            },
            1001: {
                state: tracker_utils.PR_STATE_TRIAGED,
                triageCompleted: 25
            }
        };
        expect(report_utils.mergeReportState(pullRequests, 150, 100)).toEqual({
            1000: {
                state: tracker_utils.PR_STATE_NEW,
                created: 100,
                reportState: report_utils.RS_AWAITING_TRIAGE,
                timer: 50,
                id: 1000
            },
            1001: {
                state: tracker_utils.PR_STATE_TRIAGED,
                triageCompleted: 25,
                reportState: report_utils.RS_OVERDUE_AWAITING_REVIEW,
                timer: 25,
                id: 1001
            }
        });
    });
});

describe("markOldRequests", function () {
    it("should mark reqeusts prior to a certain number as old", function () {
        var pullRequests = {
            1000: {
                id: 1000
            },
            1100: {
                id: 1100
            },
            1101: {
                id: 1101
            }
        };
        expect(report_utils.markOldRequests(pullRequests, 1100)).toEqual({
            1000: {
                id: 1000,
                old: true
            },
            1100: {
                id: 1100
            },
            1101: {
                id: 1101
            }
        });
    });
});

describe("sortIntoSections", function () {
    it("should sort pull requests into a sorted, section data structure", function () {
        var pullRequests = {
            1000: {
                reportState: report_utils.RS_IN_REVIEW,
                timer: 1
            },
            1001: {
                reportState: report_utils.RS_OVERDUE_IN_REVIEW,
                timer: 1
            },
            1002: {
                reportState: report_utils.RS_OVERDUE_AWAITING_REVIEW,
                timer: 1
            },
            1003: {
                reportState: report_utils.RS_OVERDUE_IN_TRIAGE,
                timer: 1
            },
            1004: {
                reportState: report_utils.RS_AWAITING_TRIAGE,
                timer: 1
            },
            1005: {
                reportState: report_utils.RS_IN_TRIAGE,
                timer: 1
            },
            1006: {
                reportState: report_utils.RS_AWAITING_REVIEW,
                timer: 1
            },
            1007: {
                reportState: report_utils.RS_OVERDUE_FROM_USER_IN_TRIAGE,
                timer: 1
            },
            1008: {
                reportState: report_utils.RS_OVERDUE_FROM_USER_IN_REVIEW,
                timer: 1
            },
            1009: {
                reportState: report_utils.RS_OVERDUE_AWAITING_TRIAGE,
                timer: 1
            }
        };

        expect(report_utils.sortIntoSections(pullRequests)).toEqual([
            {
                section: report_utils.RS_OVERDUE_AWAITING_REVIEW,
                pullRequests: [ pullRequests[1002] ]
            },
            {
                section: report_utils.RS_OVERDUE_AWAITING_TRIAGE,
                pullRequests: [ pullRequests[1009] ]
            },
            {
                section: report_utils.RS_AWAITING_TRIAGE,
                pullRequests: [ pullRequests[1004] ]
            },
            {
                section: report_utils.RS_AWAITING_REVIEW,
                pullRequests: [ pullRequests[1006] ]
            },
            {
                section: report_utils.RS_OVERDUE_IN_REVIEW,
                pullRequests: [ pullRequests[1001] ]
            },
            {
                section: report_utils.RS_OVERDUE_IN_TRIAGE,
                pullRequests: [ pullRequests[1003] ]
            },
            {
                section: report_utils.RS_OVERDUE_FROM_USER_IN_REVIEW,
                pullRequests: [ pullRequests[1008] ]
            },
            {
                section: report_utils.RS_OVERDUE_FROM_USER_IN_TRIAGE,
                pullRequests: [ pullRequests[1007] ]
            },
            {
                section: report_utils.RS_IN_REVIEW,
                pullRequests: [ pullRequests[1000] ]
            },
            {
                section: report_utils.RS_IN_TRIAGE,
                pullRequests: [ pullRequests[1005] ]
            }
        ]);
    });
    
    it("should sort pull requests by timer", function () {
        var pullRequests = {
            1000: {
                reportState: report_utils.RS_AWAITING_TRIAGE,
                timer: 90
            },
            1001: {
                reportState: report_utils.RS_AWAITING_TRIAGE,
                timer: 92
            },
            1002: {
                reportState: report_utils.RS_AWAITING_TRIAGE,
                timer: 40
            },
            1003: {
                reportState: report_utils.RS_OVERDUE_AWAITING_TRIAGE,
                timer: 90
            },
            1004: {
                reportState: report_utils.RS_OVERDUE_AWAITING_TRIAGE,
                timer: 92
            },
            1005: {
                reportState: report_utils.RS_OVERDUE_AWAITING_TRIAGE,
                timer: 40
            }
        };
        
        expect(report_utils.sortIntoSections(pullRequests)).toEqual([
            {
                section: report_utils.RS_OVERDUE_AWAITING_TRIAGE,
                pullRequests: [
                    pullRequests[1004],
                    pullRequests[1003],
                    pullRequests[1005]
                ]
            },
            {
                section: report_utils.RS_AWAITING_TRIAGE,
                pullRequests: [
                    pullRequests[1002],
                    pullRequests[1000],
                    pullRequests[1001]
                ]
            }
        ]);
    });
    
    it("should separate old requests", function () {
        var pullRequests = {
            1000: {
                reportState: report_utils.RS_IN_REVIEW,
                timer: 1,
                old: true
            },
            1001: {
                reportState: report_utils.RS_OVERDUE_IN_REVIEW,
                timer: 1,
                old: true
            },
            1002: {
                reportState: report_utils.RS_OVERDUE_AWAITING_REVIEW,
                timer: 1,
                old: true
            },
            1003: {
                reportState: report_utils.RS_OVERDUE_IN_TRIAGE,
                timer: 1,
                old: true
            },
            1004: {
                reportState: report_utils.RS_AWAITING_TRIAGE,
                timer: 1
            },
            1005: {
                reportState: report_utils.RS_IN_TRIAGE,
                timer: 1
            },
            1006: {
                reportState: report_utils.RS_AWAITING_REVIEW,
                timer: 1
            },
            1007: {
                reportState: report_utils.RS_OVERDUE_FROM_USER_IN_TRIAGE,
                timer: 1
            },
            1008: {
                reportState: report_utils.RS_OVERDUE_FROM_USER_IN_REVIEW,
                timer: 1
            },
            1009: {
                reportState: report_utils.RS_OVERDUE_AWAITING_TRIAGE,
                timer: 1
            }
        };

        expect(report_utils.sortIntoSections(pullRequests)).toEqual([
            {
                section: report_utils.RS_OVERDUE_AWAITING_TRIAGE,
                pullRequests: [ pullRequests[1009] ]
            },
            {
                section: report_utils.RS_AWAITING_TRIAGE,
                pullRequests: [ pullRequests[1004] ]
            },
            {
                section: report_utils.RS_AWAITING_REVIEW,
                pullRequests: [ pullRequests[1006] ]
            },
            {
                section: report_utils.RS_OVERDUE_FROM_USER_IN_REVIEW,
                pullRequests: [ pullRequests[1008] ]
            },
            {
                section: report_utils.RS_OVERDUE_FROM_USER_IN_TRIAGE,
                pullRequests: [ pullRequests[1007] ]
            },
            {
                section: report_utils.RS_IN_TRIAGE,
                pullRequests: [ pullRequests[1005] ]
            },
            {
                section: "Old " + report_utils.RS_OVERDUE_AWAITING_REVIEW,
                pullRequests: [ pullRequests[1002] ]
            },
            {
                section: "Old " + report_utils.RS_OVERDUE_IN_REVIEW,
                pullRequests: [ pullRequests[1001] ]
            },
            {
                section: "Old " + report_utils.RS_OVERDUE_IN_TRIAGE,
                pullRequests: [ pullRequests[1003] ]
            },
            {
                section: "Old " + report_utils.RS_IN_REVIEW,
                pullRequests: [ pullRequests[1000] ]
            }
        ]);
    });
});

describe("generateStatistics", function () {
    it("should count the total, overdue, available items", function () {
        var sections = [
            {
                section: report_utils.RS_OVERDUE_AWAITING_TRIAGE,
                pullRequests: [
                    {},
                    {},
                    {}
                ]
            },
            {
                section: report_utils.RS_AWAITING_TRIAGE,
                pullRequests: [
                    {}
                ]
            },
            {
                section: report_utils.RS_IN_TRIAGE,
                pullRequests: [
                    {},
                    {},
                    {},
                    {}
                ]
            },
            {
                section: report_utils.RS_AWAITING_REVIEW,
                pullRequests: [
                    {},
                    {}
                ]
            }
        ];
        expect(report_utils.generateStatistics(sections)).toEqual({
            total: 10,
            overdue: 3,
            available: 6
        });
    });
});