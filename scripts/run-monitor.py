"""Call Lastfind's idempotent scheduler with isolated, bounded retry attempts."""
import json
import os
import time
import subprocess
from datetime import datetime, timezone
from urllib.parse import urlparse


class HTTPFailure(Exception):
    def __init__(self, status):
        self.status = status


def run_monitor(url, secret, *, attempts=2, timeout=180, retry_delay=10, sleeper=time.sleep):
    if len(secret) < 32:
        raise ValueError('Configure LASTFIND_CRON_SECRET with at least 32 characters')
    parsed = urlparse(url)
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1')):
        raise ValueError('LASTFIND_URL must use HTTPS')
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('LASTFIND_URL must be an application origin')
    endpoint = url.rstrip('/') + '/api/cron'
    for attempt in range(attempts):
        try:
            # Use the transport already supported by the hosted endpoint.
            # Each invocation has a fresh output buffer, and curl does not
            # follow redirects or forward the credential to another origin.
            response = subprocess.run([
                'curl', '--silent', '--show-error', '--max-time', str(timeout),
                '--request', 'POST', '--header', 'Authorization: Bearer ' + secret,
                '--write-out', '\n%{http_code}', endpoint,
            ], capture_output=True, text=True, timeout=timeout+5)
            if response.returncode:
                raise OSError('Scheduler connection failed')
            raw, _, code = response.stdout.rpartition('\n')
            status = int(code)
            if status != 200:
                raise HTTPFailure(status)
            if len(raw) > 100000:
                raise ValueError('Scheduler response too large')
            result = json.loads(raw)
            if not isinstance(result, dict) or result.get('ok') is not True:
                raise ValueError('Scheduler did not confirm a successful cycle')
            if not isinstance(result.get('heartbeat'), str) or any(type(result.get(key)) is not int or result[key] < 0 for key in ('submitted', 'collected')):
                raise ValueError('Invalid scheduler result')
            stamp = datetime.fromisoformat(result['heartbeat'].replace('Z', '+00:00'))
            age = (datetime.now(timezone.utc) - stamp).total_seconds()
            if not -60 <= age <= 300:
                raise ValueError('Scheduler returned a stale heartbeat')
            return result
        except HTTPFailure as error:
            status = error.status
            if status not in (408, 425, 429) and status < 500:
                raise RuntimeError(f'Scheduler rejected the request (HTTP {status})') from None
            failure = f'HTTP {status}'
        except (subprocess.TimeoutExpired, TimeoutError, OSError, ValueError, KeyError, TypeError):
            failure = 'temporary connection or invalid scheduler response'
        if attempt + 1 < attempts:
            print(f'Scheduler attempt {attempt+1} failed ({failure}); retrying.', flush=True)
            sleeper(retry_delay * (attempt+1))
    raise RuntimeError(f'Scheduler failed after {attempts} attempts ({failure})')


if __name__ == '__main__':
    result = run_monitor(os.environ.get('LASTFIND_URL', ''), os.environ.get('CRON_SECRET', ''))
    print('Scheduler healthy; submitted:', result['submitted'], 'checked:', result['collected'], 'at:', result['heartbeat'])
