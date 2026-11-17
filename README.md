# Luna Airo GitHub Pages

This repository contains a simple personal GitHub Pages site for Luna Airo.

## Files
- `index.html` — homepage markup
- `styles.css` — base styling and layout

## Publish on GitHub Pages
This repository name matches the GitHub Pages site format:
`lunaairo271-jpg.github.io`

Once pushed to GitHub, the site will be available at:
https://lunaairo271-jpg.github.io/

## Customize
- Update the name, text, links, and contact email in `index.html`
- Adjust the visual styling in `styles.css`

## Next steps
- Replace the placeholder email with your real contact address
- Add your own projects, bio, and social links
- Connect a custom domain if desired

## Visualization experiments

Open `experiment/index.html` for the experiment directory, also linked from the homepage navigation and project section.

- `experiment/weekend_visualization/index.html`: community themes, radial word cloud, semantic similarity and time filtering. Its CSS, JavaScript, precomputed data and vendored D3 are included locally.
- `experiment/shenzhen_metro_visualization/index.html`: estimated Shenzhen Metro train passenger flows, map views and time playback. All runtime assets and aggregate data are embedded in this HTML file.

These pages need no backend or online data API. Only browser runtime files are included; course reports, presentations, source data, local build/test scripts and QA artifacts are not published here. The original homepage continues to use its existing Google Fonts link.

Metro trains and passenger counts are scenario estimates, not actual train occupancy. The selected 2018-09-01 sample ends at 11:30:58; missing afternoon records must not be interpreted as zero passengers. Data/model notes and AI-collaboration disclosure are retained in the page.

To preview, open the HTML files directly or serve the repository root with any static file server. After publishing the repository, the directory URL is `https://lunaairo271-jpg.github.io/experiment/`.
