[![Build Status](https://travis-ci.org/njx/github-label-tracker.svg?branch=master)](https://travis-ci.org/njx/github-label-tracker)

Utility for tracking changes to GitHub labels over time.

To run this:

* Make sure git is installed and you can do pushes to GitHub.
* `npm install`
* Create a config.json file with these entries:
    * `repo` - the repo whose labels you want to track (e.g. `njx/issue-test-repo`)
    * `labels` - array of labels you want to track; only these labels will be added to the log (e.g. `["Ready", "Development", "Review", "Testing"]`)
    * `storage` - repo where you want to store the log data (e.g. `njx/issue-test-repo-tracking`)
    * `api_key` - a GitHub personal API key (TODO: use app client key / secret)
    * (optional) `initial_timestamp` - the timestamp to use the first time this is run - set this to a time before any workflow labels are added. This must be a number as returned by Date.getTime() or Date.parse() (i.e., milliseconds since midnight on 1/1/1970).
* `npm start`

When it's done, `storage/log.json` will contain the log, and it will also be pushed
up to the repo specified in `config.storage`. The log is a JSON file:

```
{
    "_timestamp": <the last updated timestamp, as returned by Date.getTime()>,
    <issue number>: {
        <timestamp of event>: {
            "added":   <array of added labels>,
            "removed": <array of removed labels>
        },
        ...
    },
    ...
}
```

See https://github.com/njx/issue-test-repo-tracking/blob/master/log.json for an example.

Since this can only see label changes whenever it's run, labels that are added and then removed
in between runs won't be noticed. So, if you're using labels to track Kanban workflow, you might
not "see" the issue hit each column. You'll need to take that into account, and handle the case
where a card appears to "jump over" intervening columns, perhaps by allocating the time evenly
between those columns.
