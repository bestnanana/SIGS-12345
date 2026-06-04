#!/usr/bin/env python3
"""
Offline-friendly frontend deployment script.

What it does:
1. Builds the frontend locally with `npm run build`.
2. Archives local `client/dist`.
3. Uploads the archive to the remote server via SFTP.
4. Backs up and replaces `/opt/sigs-0531/client/dist` on the server.

The remote server does not need internet access. It only needs `tar` and SSH.
"""

import argparse
import os
import posixpath
import shlex
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

try:
    import paramiko
except ImportError:
    print("Missing dependency: paramiko. Install it locally with: pip install paramiko", file=sys.stderr)
    sys.exit(1)


DEFAULT_HOST = "219.223.170.20"
DEFAULT_USER = "cy"
DEFAULT_PASSWORD = "c@Xx503y"
DEFAULT_REMOTE_DIR = "/opt/sigs-0531"
DEFAULT_PM2_NAME = "campus-12345"


def run_local(command, cwd):
    print(f"[local] {' '.join(command)}")
    subprocess.run(command, cwd=cwd, check=True)


def ssh_exec(client, command):
    print(f"[remote] {command}")
    stdin, stdout, stderr = client.exec_command(command)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    code = stdout.channel.recv_exit_status()
    if out:
        print(out)
    if err:
        print(err, file=sys.stderr)
    if code != 0:
        raise RuntimeError(f"Remote command failed with exit code {code}: {command}")
    return out


def make_dist_archive(project_dir):
    dist_dir = project_dir / "client" / "dist"
    if not dist_dir.exists() or not (dist_dir / "index.html").exists():
        raise FileNotFoundError(f"Build output not found: {dist_dir}")

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    archive_path = Path(tempfile.gettempdir()) / f"sigs-client-dist-{stamp}.tar.gz"

    print(f"[local] create archive {archive_path}")
    with tarfile.open(archive_path, "w:gz") as tar:
        for path in dist_dir.rglob("*"):
            tar.add(path, arcname=path.relative_to(dist_dir))

    return archive_path, stamp


def upload_file(client, local_path, remote_path):
    print(f"[sftp] upload {local_path} -> {remote_path}")
    sftp = client.open_sftp()
    try:
        sftp.put(str(local_path), remote_path)
    finally:
        sftp.close()


def deploy(args):
    project_dir = Path(__file__).resolve().parent

    if not args.skip_build:
        run_local(["npm", "run", "build"], cwd=project_dir)

    archive_path, stamp = make_dist_archive(project_dir)
    remote_dir = args.remote_dir.rstrip("/")
    remote_client_dir = posixpath.join(remote_dir, "client")
    remote_dist_dir = posixpath.join(remote_client_dir, "dist")
    remote_tmp_archive = f"/tmp/{archive_path.name}"
    remote_new_dist = posixpath.join(remote_client_dir, f"dist.new-{stamp}")
    remote_backup_dist = posixpath.join(remote_client_dir, f"dist.bak-{stamp}")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        print(f"[ssh] connect {args.user}@{args.host}")
        client.connect(
            args.host,
            username=args.user,
            password=args.password,
            port=args.port,
            timeout=20,
        )

        ssh_exec(client, f"mkdir -p {shlex.quote(remote_client_dir)}")
        upload_file(client, archive_path, remote_tmp_archive)

        deploy_command = " && ".join([
            f"rm -rf {shlex.quote(remote_new_dist)}",
            f"mkdir -p {shlex.quote(remote_new_dist)}",
            f"tar -xzf {shlex.quote(remote_tmp_archive)} -C {shlex.quote(remote_new_dist)}",
            f"if [ -d {shlex.quote(remote_dist_dir)} ]; then mv {shlex.quote(remote_dist_dir)} {shlex.quote(remote_backup_dist)}; fi",
            f"mv {shlex.quote(remote_new_dist)} {shlex.quote(remote_dist_dir)}",
            f"rm -f {shlex.quote(remote_tmp_archive)}",
        ])
        ssh_exec(client, deploy_command)

        if args.restart:
            restart_command = (
                f"if command -v pm2 >/dev/null 2>&1 && pm2 describe {shlex.quote(args.pm2_name)} >/dev/null 2>&1; "
                f"then pm2 restart {shlex.quote(args.pm2_name)} --update-env; "
                f"else echo 'PM2 process not found, skipped restart.'; fi"
            )
            ssh_exec(client, restart_command)

        print("")
        print("Deploy finished.")
        print(f"Remote dist: {remote_dist_dir}")
        print(f"Backup dist: {remote_backup_dist}")
    finally:
        client.close()
        try:
            archive_path.unlink()
        except OSError:
            pass


def parse_args():
    parser = argparse.ArgumentParser(description="Deploy local frontend build to the offline remote server.")
    parser.add_argument("--host", default=os.getenv("DEPLOY_HOST", DEFAULT_HOST))
    parser.add_argument("--port", type=int, default=int(os.getenv("DEPLOY_PORT", "22")))
    parser.add_argument("--user", default=os.getenv("DEPLOY_USER", DEFAULT_USER))
    parser.add_argument("--password", default=os.getenv("DEPLOY_PASSWORD", DEFAULT_PASSWORD))
    parser.add_argument("--remote-dir", default=os.getenv("DEPLOY_REMOTE_DIR", DEFAULT_REMOTE_DIR))
    parser.add_argument("--pm2-name", default=os.getenv("DEPLOY_PM2_NAME", DEFAULT_PM2_NAME))
    parser.add_argument("--skip-build", action="store_true", help="Use existing client/dist instead of running npm run build.")
    parser.add_argument("--restart", action="store_true", help="Restart the PM2 process after replacing static files.")
    return parser.parse_args()


if __name__ == "__main__":
    try:
        deploy(parse_args())
    except Exception as exc:
        print(f"Deploy failed: {exc}", file=sys.stderr)
        sys.exit(1)
