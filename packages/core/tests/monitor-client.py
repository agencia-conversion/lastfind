"""Exercise the real scheduler client against a local HTTP failure/recovery server."""
import importlib.util
import json
import threading
import unittest
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

spec = importlib.util.spec_from_file_location('monitor', Path(__file__).parents[3] / 'scripts/run-monitor.py')
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


class MonitorClientTests(unittest.TestCase):
    def exercise(self, responses, expected_calls, error=None):
        calls=[]
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                calls.append((self.path,self.headers.get('Authorization')))
                status,body=responses[min(len(calls)-1,len(responses)-1)]
                self.send_response(status);self.end_headers();self.wfile.write(body.encode())
            def log_message(self,*args): pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            call=lambda:monitor.run_monitor(f'http://127.0.0.1:{server.server_port}','s'*64,retry_delay=0)
            if error:
                with self.assertRaises(error):call()
            else:
                self.assertTrue(call()['ok'])
            self.assertEqual(len(calls),expected_calls)
            self.assertTrue(all(path=='/api/cron' and auth=='Bearer '+'s'*64 for path,auth in calls))
        finally:server.shutdown();server.server_close();thread.join()
    def healthy(self):
        return (200,json.dumps({'ok':True,'heartbeat':datetime.now(timezone.utc).isoformat(),'submitted':0,'collected':0}))
    def test_500_body_does_not_contaminate_success_body(self):
        self.exercise([(500,'{"error":"D1 timeout"}'),self.healthy()],2)
    def test_malformed_response_is_retried(self):
        self.exercise([(200,'not json'),self.healthy()],2)
    def test_rejects_unauthorized_without_retry(self):
        self.exercise([(401,'{"error":"Denied"}')],1,RuntimeError)
    def test_failure_is_bounded(self):
        self.exercise([(503,'unavailable')],2,RuntimeError)
    def test_stale_heartbeat_is_not_success(self):
        self.exercise([(200,'{"ok":true,"heartbeat":"2020-01-01T00:00:00Z"}')],2,RuntimeError)

if __name__=='__main__':unittest.main()
