# Facets

Facets is a Windows desktop application by **Cynmark Systems Limited**. It turns an edited photographic archive into a structured, searchable, privacy-controlled library and (in later stages) publishes it to websites as JSON. It reads the exported JPEGs and never changes them.

© Cynmark Systems Limited. Facets and its concept are owned by Cynmark Systems Limited. All rights reserved.

The full brief is [docs/Facets_Requirements.md](docs/Facets_Requirements.md). Facets is built in the stages of its section 29.

## Version 0.1.0: stage 1, Foundation

- **Installs beside Legend.** Its own app ID (`app.cynmark.facets`), program folder, settings folder (`%APPDATA%\Facets`) and library format (`*.facetslib`). Facets refuses to open a Legend library and never writes to one.
- **Complete data model.** The library database already holds every table the later stages need (Series, Facet trees, domains, palettes, sites, the operation history, AI exchange, workflow progress), with full-text search and a spatial index. Future versions only add to it.
- **Five Facets and Location.** A new library has Subject, Activity, Event, People and Theme with their starter top levels, plus the Location tree. People › Family is Private.
- **Import.** Folders of JPEGs, matched by raw key. Importing the same folder again changes nothing. Re-exported files keep all catalogue data. Two files with one raw key ask: variants or replacement. Lightroom keywords map into the Facets (Options › Keyword root mapping) and arrive as **Internal** tags until reviewed. An import can be told **not to retain location** for private places.
- **Views.** Grid, table and single view. The whole photo always fits its tile, portrait or landscape, and the footer text always shows.
- **Thumbnail display.** Up to three footer lines, each icon switchable, seven sizes (slider or Ctrl+wheel), and the presets Clean, Cataloguing and Locating. View › Icon legend explains every icon.
- **Menu bar** (File, Edit, View, Organise, Tools, Options, Help, with Alt access keys) and workspace tabs. Commands from later stages are shown greyed with their stage number.
- **About Facets** with the ownership notice, also shown on the welcome screen.
- Carried over from Legend: the look, describe and bulk editing, copy and paste fields, undo and redo, shoots and Photo IDs, the name registry, the hierarchy explorer, and the small Locate map.

## Version 0.2.0: stages 2 and 3, Sets, Shoots, Facets and Series

- **Title bar:** the modules (Library, Map, Series, Hierarchies, Registry, History) sit on the right in larger type, like Lightroom. The menus are File, Edit, View, Organise, Tools and Help (Settings is under Edit). The library name is in the status bar.
- **Single view:** drag the bar under the large photo to give the thumbnails more rows. The thumbnails are the same tiles as the grid, with the same icons, footer lines and sizes (Ctrl+wheel).
- **Sets as the working scope:** click a Set to make it active. Beneath it the navigator shows its Shoots, Series and Facet entries, with counts that filter the Set when clicked. A scope switch (Active Set / All Library / Current selection) sits at the left of the toolbar. Each Set remembers its filters, sort and view, and Facets reopens the last Set after a restart. Set commands: add or remove the selection, replace contents, duplicate, rename, archive, and New Set from the current view.
- **Shoots:** Tools › Propose Shoots suggests Shoots from time gaps and position jumps. Nothing is created until you accept. Shoot details show the derived date span.
- **Facet trees:** cross-references between entries in different trees (Hierarchies, entry details). Short codes work in every picker. Tree files: export one tree or all trees as JSON, and import a tree file with a preview first. Node IDs are kept, so keyword trees built in a test library can be carried into new libraries and later versions. Tidy-up report. Adding a sixth Facet is a guarded, advanced action.
- **Series:** New Series from the selection (Ctrl+Shift+N) with a warning when it would largely repeat another Series. Each Series has a permanent ID (SER-000001), one Primary Facet and keyword, supporting keywords, summary, narrative, cover, up to 12 featured photos, a manual or capture-time order, places, an anchor, privacy and status. It appears once in the navigator under its Primary Facet. The Series workspace shows every Series as cards with the full editor. The inspector's Series tab lists a photo's Series, and becomes the Series editor when a Series is the target. "Apply Series keywords to members" is an explicit, previewed, undoable command. The Registry lists every Series ID with its earlier titles.
- **Filter manifest** (File › Read Filter Manifest) and **Re-read embedded metadata** for chosen fields (Tools).

## Building keyword trees on a test library

Everything you build is kept when you install a newer version: libraries are only ever added to, never rebuilt. You can also move your trees between libraries: in Hierarchies, choose **+ › Export all trees (JSON)**, then in another library **+ › Import tree file (JSON)**. Entries keep their IDs, short codes, aliases and cross-references.

## Installing on Windows

Run `Facets-Setup-x.y.z.exe`. It installs for your user only (no administrator rights), lets you choose the folder, and adds a desktop shortcut and a Start menu entry named Facets. Windows may show "Windows protected your PC" the first time, because the installer is not signed yet: choose **More info**, then **Run anyway**.

Installing a newer version over an older one keeps everything. Uninstalling never deletes a library; it asks whether to remove Facets settings as well (the default is No).

Every push of a version tag (for example `v0.1.0`) to GitHub builds the installer on a Windows machine and attaches it to the release under **Releases**. It can also be built from the **Actions** tab ("Build Windows installer", then "Run workflow").

## Where things are stored

| What | Where |
|---|---|
| The catalogue | `Name.facetslib\library.sqlite` |
| Thumbnails | `Name.facetslib\thumbs\` (rebuildable) |
| Automatic backups (last 30) | `Name.facetslib\backups\` |
| Logs | `Name.facetslib\logs\` |
| Window layout and interface preferences | `%APPDATA%\Facets\` |

## For developers

Node.js 22 or newer. `npm install`, then `npm test` and `npm run dist` (the installer appears in `dist`). The reference implementation is SCMWJTT/legend.
