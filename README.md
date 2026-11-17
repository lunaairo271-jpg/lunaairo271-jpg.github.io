# Data visualization experiments

The site homepage (`index.html`) is the experiment directory. It replaces the earlier portfolio landing page and directly opens either experiment. The same directory remains available at `experiment/index.html`; its relative links are adjusted for that location.

## Pages

- `/`: experiment directory and site homepage.
- `/experiment/`: the same directory under the experiments folder.
- `/experiment/weekend_visualization/`: community themes, radial word cloud, semantic similarity and time filtering. CSS, JavaScript, precomputed data and vendored D3 are included locally.
- `/experiment/shenzhen_metro_visualization/`: estimated Shenzhen Metro train passenger flows, map views and time playback. Runtime assets and aggregate data are embedded in one HTML file.

All current pages can run without a backend or online data API. Only browser runtime files are included; course reports, presentations, raw source datasets, local build/test scripts and QA artifacts are not published. Local absolute source paths have been removed from the public metro copy.

Metro trains and passenger counts are scenario estimates, not actual train occupancy. The selected 2018-09-01 sample ends at 11:30:58; missing afternoon records must not be interpreted as zero passengers. Data/model notes and AI-collaboration disclosure are retained in the page.

## Preview and publish

Open the HTML files directly or serve this repository root with any static file server. The experiment directory on the site homepage uses `./experiment/...` links; the copy inside `experiment/` uses sibling links.

Push `main` to publish through the repository's GitHub Pages configuration. The site URL is https://lunaairo271-jpg.github.io/ and the experiment directory is also reachable at https://lunaairo271-jpg.github.io/experiment/.

The previous portfolio markup remains recoverable in Git history. Its unused `styles.css` is retained and is not loaded by the experiment directory.
