# Enable GitHub Pages for the dark prototype

The workflow `.github/workflows/deploy-ui-prototype.yml` publishes only the contents of `ui-prototype/`. The backend, iOS app, repository root, and sample screenshots are outside the publication artifact.

## One-time administrator setup

The authenticated contributor has write access but no repository administration access. A repository administrator must enable Pages:

1. Open https://github.com/beomjin-seo/Pilot-Testing/settings/pages.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Keep the repository private. If GitHub reports that the owner's plan does not support Pages for a private repository, that hosting prerequisite must be resolved separately.
4. Open **Actions → Deploy dark UI prototype → Run workflow**, select `main`, and run it.

The contributor can trigger the workflow after the administrator completes step 2. No new credential or secret is needed for the standard Pages deployment.

## After setup

The deployment job and `github-pages` environment report the live URL. Open its root to enter the dark prototype, or append `dark-board.html` for the storyboard. Do not treat a predicted `github.io` URL as live until the deployment succeeds.

Changes to UI assets on `main` trigger an update automatically. Markdown-only changes do not trigger a deployment. Workflow changes can be deployed using **Run workflow**.

This addition does not activate Pages or change repository visibility by itself. All existing repository files were preserved.
