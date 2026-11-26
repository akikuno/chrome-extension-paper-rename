import json
import os
import sys
from time import sleep
from zipfile import ZipFile

API = "https://chromewebstore.googleapis.com"
ACTIVE_STATES = {"PENDING_REVIEW", "STAGED"}


def version_key(version):
    parts = tuple(map(int, version.split(".")))
    return parts + (0,) * (4 - len(parts))


def revision_versions(revision):
    return [
        version_key(channel["crxVersion"])
        for channel in revision.get("distributionChannels", [])
        if channel.get("crxVersion")
    ]


def api_request(session, method, url, **kwargs):
    response = session.request(method, url, timeout=45, **kwargs)
    if not response.ok:
        error = response.json().get("error", {})
        raise SystemExit(f"Chrome Web Store HTTP {response.status_code}: {error.get('message', '')}")
    return response.json()


def submit(session, item, package):
    with ZipFile(package) as archive:
        version = json.loads(archive.read("manifest.json"))["version"]
    status_url = f"{API}/v2/{item}:fetchStatus"
    status = api_request(session, "GET", status_url)
    published = revision_versions(status.get("publishedItemRevisionStatus", {}))
    submitted = status.get("submittedItemRevisionStatus", {})
    if not published:
        raise SystemExit("Publish the first unlisted release in the Developer Dashboard first.")
    if version_key(version) <= max(published):
        print(f"Version {version} is already published or older. Increase manifest.json version to release.")
        return
    if submitted.get("state") in ACTIVE_STATES:
        if version_key(version) in revision_versions(submitted):
            print(f"Version {version} has already been submitted.")
            return
        raise SystemExit("Another release is in review or staged. Run this workflow again after it finishes.")

    with open(package, "rb") as archive:
        result = api_request(
            session, "POST", f"{API}/upload/v2/{item}:upload",
            data=archive, headers={"Content-Type": "application/zip"},
        )
    state = result.get("uploadState")
    for _ in range(24):
        if state != "IN_PROGRESS":
            break
        sleep(5)
        state = api_request(session, "GET", status_url).get("lastAsyncUploadState", "IN_PROGRESS")
    if state != "SUCCEEDED":
        raise SystemExit(f"Chrome Web Store package upload did not succeed: {state}")

    result = api_request(
        session, "POST", f"{API}/v2/{item}:publish",
        json={"publishType": "DEFAULT_PUBLISH"},
    )
    print(f"Version {version} submitted to the Chrome Web Store: {result.get('state', 'accepted')}")


def main():
    from requests import Session
    from requests.exceptions import RequestException

    names = ("CWS_PUBLISHER_ID", "CWS_EXTENSION_ID", "CWS_ACCESS_TOKEN")
    missing = [name for name in names if not os.environ.get(name)]
    if missing:
        raise SystemExit(f"Missing GitHub Actions configuration: {', '.join(missing)}")
    publisher, extension, token = (os.environ[name] for name in names)
    with Session() as session:
        session.headers["Authorization"] = f"Bearer {token}"
        try:
            submit(session, f"publishers/{publisher}/items/{extension}", sys.argv[1])
        except RequestException:
            raise SystemExit("The request to the Chrome Web Store API failed.") from None


if __name__ == "__main__":
    main()
