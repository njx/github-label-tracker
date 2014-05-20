Utility for tracking changes to GitHub labels over time.

To run this, do `npm install`, then create a config.json file with these entries:

* `repo` - the repo whose labels you want to track (e.g. "njx/issue-test-repo")
* `labels` - array of labels you want to track; only these labels will be added to the log (e.g. ["Ready", "Development", "testing"])
* `storage` - repo where you want to store the log data (TODO: not yet implemented)
* `api_key` - a GitHub personal API key (TODO: use app client key / secret)

Then `npm start`. When it's done, `data/log.json` will contain the log. This is a JSON
object mapping issue numbers to log objects for those issues. Each log object is itself
a map from timestamps to {added, removed} arrays listing the labels that were added and
removed at that timestamp. The log object for an issue also contains a "labels" key that
lists the latest labels for that issue. There is also a `_timestamp` object on the top-level
log indicating the latest updated time over all issues that were fetched during the previous
run.
