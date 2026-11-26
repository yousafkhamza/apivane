Most API clients now want an account, a cloud workspace and a paid seat before your team can share a collection. And none of them tell you when the API you're testing leaks a secret or ships without security headers.

So I built ApiVane: a free, open-source API client that runs in your browser and checks security on every response.

What you can do:
🔹 Send requests and inspect JSON, headers and timing; copy any request as cURL
🔹 Add tests without writing code: status, JSON values, headers, response time
🔹 Save a login token from one response and reuse it as {{token}} in the next request
🔹 Import Postman collections and cURL commands
🔹 Get security findings on every response: missing headers, risky CORS, secrets or stack traces in responses, unsafe cookies, plain http, keys in URLs
🔹 Run the same collection in CI with one command or the GitHub Action, with a JUnit report and job summary

No account and no login. Your work stays in your browser with autosave, and a backup file moves it to another device. Collections can also live in your repo as plain YAML, so changes go through pull requests like code.

Browsers block many API calls from websites (CORS), so there are three ways to send requests:
🌐 Browser only: nothing to install
🧩 Chrome / Edge / Firefox extension: no CORS limits, every header visible
⌘ Local agent (npx apivane or Docker): localhost APIs, repo files, CI runner

How it's built:
⚙️ Zero dependencies: plain JavaScript modules, no bundler, no lockfile to break
🔒 Strict Content-Security-Policy; the extension answers only the ApiVane app and never sends your cookies; the agent binds to 127.0.0.1 with a fresh token on every start
🧪 Unit, agent and runner tests, plus browser tests on desktop Chrome, mobile and Firefox
🚀 CI/CD to GitHub Pages, with automatic semantic releases from conventional commits: npm package, multi-arch Docker image and extension zips on every release

Try it: https://yousafkhamza.github.io/apivane/
Source: https://github.com/yousafkhamza/apivane

Feedback welcome. Which security check would you want next?

#API #APITesting #DevSecOps #OpenSource #GitHubActions #WebDevelopment #Postman
