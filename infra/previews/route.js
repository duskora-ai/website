// CloudFront viewer-request function (cloudfront-js-2.0) for website pull request previews.
// Terraform fills in the host pattern; see main.tf.
function handler(event) {
  var request = event.request;
  var host = request.headers.host ? request.headers.host.value.toLowerCase() : '';
  var match = host.match(/${host_pattern}/);
  if (!match) {
    return { statusCode: 404, statusDescription: 'Not Found' };
  }

  var uri = request.uri;
  var lastSlash = uri.lastIndexOf('/');
  if (uri.endsWith('/')) {
    uri += 'index.html';
  } else if (uri.indexOf('.', lastSlash) === -1) {
    // A folder without its trailing slash, like /terms: redirect as GitHub Pages does.
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: uri + '/' } },
    };
  }

  request.uri = '/' + match[1] + uri;
  return request;
}
