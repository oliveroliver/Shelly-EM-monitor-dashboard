// Shelly EM Dashboard Script
// Serves the monitoring dashboard at http://<device-ip>/script/<id>/ui

let D = "__BASE64_GZIP__";
D = atob(D);

HTTPServer.registerEndpoint("ui", function (req, res) {
  res.code = 200;
  res.body = D;
  res.headers = [
    ["Content-Type", "text/html"],
    ["Content-Encoding", "gzip"],
    ["Cache-Control", "no-cache"]
  ];
  res.send();
});
