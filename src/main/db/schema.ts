// Facets library database structure. Each entry upgrades the library by one version.
// Rules: never edit a released migration; only append new ones. Migrations only ADD
// tables, columns or indexes, so the owner's earlier work is always carried forward.
//
// Version 1 creates the complete data model for every planned stage (requirements Appendix B),
// so later stages only add to it.
//
// Naming notes:
//  - Every table's internal key is `id` (the permanent hidden record ID).
//  - Public identities live in `public_id`: Photo ID (ASHW-00001) on photos,
//    Series ID (SER-000014) on series, node IDs (subj-0142) on nodes.

export const MIGRATIONS: string[] = [
  // ---- version 1 ----
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  -- ---------------------------------------------------------------- photos
  CREATE TABLE photos (
    id INTEGER PRIMARY KEY,
    raw_key TEXT NOT NULL COLLATE NOCASE,
    variant_no INTEGER NOT NULL DEFAULT 0,
    public_id TEXT UNIQUE,                       -- Photo ID, e.g. ASHW-00001
    published_name TEXT,
    status TEXT NOT NULL DEFAULT 'draft',        -- draft | ready | published | withdrawn
    title TEXT NOT NULL DEFAULT '',
    caption TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    alt TEXT NOT NULL DEFAULT '',
    rating INTEGER NOT NULL DEFAULT 0,
    creator TEXT NOT NULL DEFAULT '',
    copyright TEXT NOT NULL DEFAULT '',
    licence TEXT NOT NULL DEFAULT '',
    credit TEXT NOT NULL DEFAULT '',
    shoot_id INTEGER,
    shoot_provenance TEXT NOT NULL DEFAULT '',   -- user | embedded | heuristic | ai | verified
    lat REAL, lon REAL, elevation REAL,          -- current position
    cam_lat REAL, cam_lon REAL, cam_ele REAL,    -- camera position, never altered
    pos_source TEXT NOT NULL DEFAULT 'none',     -- camera | hand | node | none
    show_elevation INTEGER NOT NULL DEFAULT 0,
    precision TEXT NOT NULL DEFAULT 'rounded',   -- exact | rounded | approximate | hidden
    location_state TEXT NOT NULL DEFAULT 'missing_gps',
      -- known | approximate | unknown | missing_gps | hidden | not_retained | not_applicable
    private_place INTEGER NOT NULL DEFAULT 0,
    people INTEGER NOT NULL DEFAULT 0,
    privacy TEXT NOT NULL DEFAULT 'inherit',     -- inherit | public | private | internal
    captured TEXT,
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    camera_body TEXT NOT NULL DEFAULT '',
    lens TEXT NOT NULL DEFAULT '',
    focal REAL, aperture REAL,
    shutter TEXT NOT NULL DEFAULT '',
    iso INTEGER,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    file_mtime REAL NOT NULL DEFAULT 0,
    file_hash TEXT NOT NULL DEFAULT '',
    file_offline INTEGER NOT NULL DEFAULT 0,
    filter_batch TEXT NOT NULL DEFAULT '',       -- from a Filter manifest
    thumb_ver INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    exported_at TEXT,
    retired INTEGER NOT NULL DEFAULT 0,
    UNIQUE (raw_key, variant_no)
  );
  CREATE INDEX photos_shoot ON photos(shoot_id);
  CREATE INDEX photos_captured ON photos(captured);

  -- Full-text search over photo text (kept in step by triggers).
  CREATE VIRTUAL TABLE photo_fts USING fts5(
    title, caption, note, alt, raw_key, public_id,
    content='photos', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER photos_fts_ai AFTER INSERT ON photos BEGIN
    INSERT INTO photo_fts(rowid, title, caption, note, alt, raw_key, public_id)
    VALUES (new.id, new.title, new.caption, new.note, new.alt, new.raw_key, new.public_id);
  END;
  CREATE TRIGGER photos_fts_ad AFTER DELETE ON photos BEGIN
    INSERT INTO photo_fts(photo_fts, rowid, title, caption, note, alt, raw_key, public_id)
    VALUES ('delete', old.id, old.title, old.caption, old.note, old.alt, old.raw_key, old.public_id);
  END;
  CREATE TRIGGER photos_fts_au AFTER UPDATE OF title, caption, note, alt, raw_key, public_id ON photos BEGIN
    INSERT INTO photo_fts(photo_fts, rowid, title, caption, note, alt, raw_key, public_id)
    VALUES ('delete', old.id, old.title, old.caption, old.note, old.alt, old.raw_key, old.public_id);
    INSERT INTO photo_fts(rowid, title, caption, note, alt, raw_key, public_id)
    VALUES (new.id, new.title, new.caption, new.note, new.alt, new.raw_key, new.public_id);
  END;

  -- Spatial index over current positions (kept in step by triggers).
  CREATE VIRTUAL TABLE photo_rtree USING rtree(id, min_lat, max_lat, min_lon, max_lon);
  CREATE TRIGGER photos_rt_ai AFTER INSERT ON photos WHEN new.lat IS NOT NULL AND new.lon IS NOT NULL BEGIN
    INSERT OR REPLACE INTO photo_rtree VALUES (new.id, new.lat, new.lat, new.lon, new.lon);
  END;
  CREATE TRIGGER photos_rt_au AFTER UPDATE OF lat, lon ON photos BEGIN
    DELETE FROM photo_rtree WHERE id = old.id;
    INSERT INTO photo_rtree SELECT new.id, new.lat, new.lat, new.lon, new.lon
      WHERE new.lat IS NOT NULL AND new.lon IS NOT NULL;
  END;
  CREATE TRIGGER photos_rt_ad AFTER DELETE ON photos BEGIN
    DELETE FROM photo_rtree WHERE id = old.id;
  END;

  -- ---------------------------------------------------------------- shoots
  CREATE TABLE shoots (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    time_zone TEXT NOT NULL DEFAULT '',
    clock_offset_min INTEGER NOT NULL DEFAULT 0,
    privacy TEXT NOT NULL DEFAULT 'private',
    cover_photo_id INTEGER,
    places TEXT NOT NULL DEFAULT '[]',
    archived INTEGER NOT NULL DEFAULT 0,
    next_number INTEGER NOT NULL DEFAULT 1,
    retired INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  -- ---------------------------------------------------------------- series
  CREATE TABLE series (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,              -- Series ID, e.g. SER-000014
    title TEXT NOT NULL,
    slug TEXT NOT NULL DEFAULT '',
    slug_frozen INTEGER NOT NULL DEFAULT 0,
    summary TEXT NOT NULL DEFAULT '',
    narrative TEXT NOT NULL DEFAULT '',
    primary_node_id INTEGER,
    theme_rationale TEXT NOT NULL DEFAULT '',
    privacy TEXT NOT NULL DEFAULT 'private',
    cover_photo_id INTEGER,
    member_order TEXT NOT NULL DEFAULT 'capture', -- capture | manual
    anchor_lat REAL, anchor_lon REAL,
    anchor_set INTEGER NOT NULL DEFAULT 0,
    anchor_mode TEXT NOT NULL DEFAULT 'exact',   -- exact | approximate | hidden
    date_label TEXT NOT NULL DEFAULT '',
    writeup TEXT NOT NULL DEFAULT '',
    sources TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    verified INTEGER NOT NULL DEFAULT 0,
    provenance TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL,
    retired INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE series_members (
    id INTEGER PRIMARY KEY,
    series_id INTEGER NOT NULL,
    photo_id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    UNIQUE (series_id, photo_id)
  );
  CREATE INDEX series_members_photo ON series_members(photo_id);
  CREATE TABLE series_featured (
    id INTEGER PRIMARY KEY,
    series_id INTEGER NOT NULL,
    photo_id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    UNIQUE (series_id, photo_id)
  );
  CREATE TABLE series_nodes (
    id INTEGER PRIMARY KEY,
    series_id INTEGER NOT NULL,
    node_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'supporting',
    domain TEXT NOT NULL DEFAULT 'public',
    UNIQUE (series_id, node_id)
  );
  CREATE TABLE series_places (
    id INTEGER PRIMARY KEY,
    series_id INTEGER NOT NULL,
    node_id INTEGER NOT NULL,
    UNIQUE (series_id, node_id)
  );
  CREATE VIRTUAL TABLE series_fts USING fts5(
    title, summary, narrative, public_id, content='series', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER series_fts_ai AFTER INSERT ON series BEGIN
    INSERT INTO series_fts(rowid, title, summary, narrative, public_id) VALUES (new.id, new.title, new.summary, new.narrative, new.public_id);
  END;
  CREATE TRIGGER series_fts_ad AFTER DELETE ON series BEGIN
    INSERT INTO series_fts(series_fts, rowid, title, summary, narrative, public_id) VALUES ('delete', old.id, old.title, old.summary, old.narrative, old.public_id);
  END;
  CREATE TRIGGER series_fts_au AFTER UPDATE OF title, summary, narrative ON series BEGIN
    INSERT INTO series_fts(series_fts, rowid, title, summary, narrative, public_id) VALUES ('delete', old.id, old.title, old.summary, old.narrative, old.public_id);
    INSERT INTO series_fts(rowid, title, summary, narrative, public_id) VALUES (new.id, new.title, new.summary, new.narrative, new.public_id);
  END;

  -- ---------------------------------------------------------------- trees and nodes
  -- One engine serves the five Facet trees, the Location tree and legacy trees.
  CREATE TABLE trees (
    id INTEGER PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'facet',          -- facet | location | legacy
    icon TEXT NOT NULL DEFAULT '',
    definition TEXT NOT NULL DEFAULT '',
    guidance TEXT NOT NULL DEFAULT '',
    multi INTEGER NOT NULL DEFAULT 1,
    levels TEXT NOT NULL DEFAULT '[]',
    has_position INTEGER NOT NULL DEFAULT 0,
    domain_default TEXT NOT NULL DEFAULT 'public',
    sort_order INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,           -- hidden from pickers (legacy trees)
    id_prefix TEXT NOT NULL,
    next_public INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE nodes (
    id INTEGER PRIMARY KEY,
    tree_id INTEGER NOT NULL,
    parent_id INTEGER,
    public_id TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    aliases TEXT NOT NULL DEFAULT '[]',
    short_code TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    cover_photo_id INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    refs TEXT NOT NULL DEFAULT '{}',
    lat REAL, lon REAL, zoom INTEGER,
    domain TEXT NOT NULL DEFAULT '',             -- '' = use the tree's default; public | private | internal
    hidden INTEGER NOT NULL DEFAULT 0,           -- hidden from navigation (display only)
    retired INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX nodes_parent ON nodes(parent_id);
  CREATE INDEX nodes_tree ON nodes(tree_id);

  -- Derived ancestor table: rebuilt from nodes.parent_id whenever a tree changes.
  CREATE TABLE node_closure (
    ancestor INTEGER NOT NULL,
    descendant INTEGER NOT NULL,
    depth INTEGER NOT NULL,
    PRIMARY KEY (ancestor, descendant)
  );
  CREATE INDEX closure_desc ON node_closure(descendant);

  CREATE TABLE node_xrefs (
    id INTEGER PRIMARY KEY,
    node_id INTEGER NOT NULL,
    other_node_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'related',
    UNIQUE (node_id, other_node_id)
  );

  CREATE TABLE photo_nodes (
    id INTEGER PRIMARY KEY,
    photo_id INTEGER NOT NULL,
    node_id INTEGER NOT NULL,
    domain TEXT NOT NULL DEFAULT 'public',       -- public | private | internal
    provenance TEXT NOT NULL DEFAULT 'user',     -- user | embedded | palette | ai | migration
    confidence REAL,
    UNIQUE (photo_id, node_id)
  );
  CREATE INDEX photo_nodes_node ON photo_nodes(node_id);

  -- ---------------------------------------------------------------- sets and views
  CREATE TABLE sets (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'manual',         -- import | manual
    state TEXT NOT NULL DEFAULT '{}',            -- remembered view state for reopening
    created_at TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    retired INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE set_members (
    id INTEGER PRIMARY KEY,
    set_id INTEGER NOT NULL,
    photo_id INTEGER NOT NULL,
    UNIQUE (set_id, photo_id)
  );
  CREATE INDEX set_members_photo ON set_members(photo_id);

  CREATE TABLE saved_views (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    definition TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    retired INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE palettes (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    retired INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE palette_buttons (
    id INTEGER PRIMARY KEY,
    palette_id INTEGER NOT NULL,
    node_id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );

  -- ---------------------------------------------------------------- sites and publishing
  CREATE TABLE sites (
    id INTEGER PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    export_folder TEXT NOT NULL DEFAULT '',
    decimals INTEGER NOT NULL DEFAULT 3,
    trees TEXT NOT NULL DEFAULT '[]',
    fields TEXT NOT NULL DEFAULT '[]',
    config TEXT NOT NULL DEFAULT '{}',
    retired INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE photo_sites (
    id INTEGER PRIMARY KEY,
    photo_id INTEGER NOT NULL,
    site_id INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'selected',      -- selected | published | withdrawn
    published_at TEXT,
    private_series_ok INTEGER NOT NULL DEFAULT 0,
    UNIQUE (photo_id, site_id)
  );
  CREATE TABLE series_sites (
    id INTEGER PRIMARY KEY,
    series_id INTEGER NOT NULL,
    site_id INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'selected',
    published_at TEXT,
    UNIQUE (series_id, site_id)
  );

  -- ---------------------------------------------------------------- permanent identity records
  -- Every Photo ID ever issued. Rows are never deleted.
  CREATE TABLE id_registry (
    public_id TEXT PRIMARY KEY,
    shoot_code TEXT NOT NULL,
    number INTEGER NOT NULL,
    photo_id INTEGER,
    raw_key TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'active',        -- active | retired
    issued_at TEXT NOT NULL,
    retired_at TEXT
  );
  -- Every Series ID ever issued. Rows are never deleted.
  CREATE TABLE series_registry (
    public_id TEXT PRIMARY KEY,
    number INTEGER NOT NULL,
    series_row_id INTEGER,
    title TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'active',
    issued_at TEXT NOT NULL,
    retired_at TEXT
  );
  CREATE TABLE name_history (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'photo',          -- photo (published name) | series_title | series_slug
    row_id INTEGER NOT NULL,
    old_name TEXT NOT NULL,
    new_name TEXT NOT NULL,
    at TEXT NOT NULL
  );
  CREATE TABLE aliases (
    id INTEGER PRIMARY KEY,
    alias TEXT NOT NULL,                         -- e.g. MALM-s02, a Legend node ID
    target_kind TEXT NOT NULL,                   -- series | node | photo | shoot
    target_id INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    at TEXT NOT NULL
  );
  CREATE INDEX aliases_alias ON aliases(alias);

  -- ---------------------------------------------------------------- history of imports and exports
  CREATE TABLE imports (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    folder TEXT NOT NULL,
    scanned INTEGER NOT NULL, added INTEGER NOT NULL, known INTEGER NOT NULL,
    changed INTEGER NOT NULL, variants INTEGER NOT NULL, skipped INTEGER NOT NULL,
    set_id INTEGER,
    options TEXT NOT NULL DEFAULT '{}',
    report TEXT NOT NULL
  );
  CREATE TABLE exports (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    site_id INTEGER,
    kind TEXT NOT NULL DEFAULT 'snapshot',       -- snapshot | sidecar | legend | ai_package | backup
    folder TEXT NOT NULL DEFAULT '',
    report TEXT NOT NULL
  );

  -- ---------------------------------------------------------------- operation history
  -- One row per user, AI or system action (one undo step).
  CREATE TABLE operations (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    label TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',       -- manual | palette | bulk | ai_patch | migration | import | publish | system
    scope TEXT NOT NULL DEFAULT '',
    targets TEXT NOT NULL DEFAULT '[]',          -- concrete photo record IDs touched
    params TEXT NOT NULL DEFAULT '{}',
    result TEXT NOT NULL DEFAULT '{}',
    undone INTEGER NOT NULL DEFAULT 0,
    reverted_by INTEGER,
    external INTEGER NOT NULL DEFAULT 0          -- exports: logged, never undone
  );
  -- Every row-level change made by an operation. Used for undo, redo, revert and field history.
  CREATE TABLE changes (
    id INTEGER PRIMARY KEY,
    op_id INTEGER NOT NULL,
    op TEXT NOT NULL,                            -- set | insert | delete
    tbl TEXT NOT NULL,
    row_id INTEGER NOT NULL,
    photo_id INTEGER,
    field TEXT,
    old_value TEXT,
    new_value TEXT
  );
  CREATE INDEX changes_row ON changes(tbl, row_id);
  CREATE INDEX changes_photo ON changes(photo_id);
  CREATE INDEX changes_op ON changes(op_id);

  -- ---------------------------------------------------------------- AI exchange
  CREATE TABLE ai_batches (
    id INTEGER PRIMARY KEY,
    batch_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT '',
    privacy TEXT NOT NULL DEFAULT '{}',
    manifest TEXT NOT NULL DEFAULT '{}',
    state TEXT NOT NULL DEFAULT 'issued'
  );
  CREATE TABLE ai_proposals (
    id INTEGER PRIMARY KEY,
    batch_id TEXT NOT NULL,
    kind TEXT NOT NULL,                          -- photo | node | shoot | series | note
    ref TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL DEFAULT '{}',
    state TEXT NOT NULL DEFAULT 'pending',       -- pending | accepted | rejected
    op_id INTEGER
  );
  CREATE INDEX ai_proposals_batch ON ai_proposals(batch_id);

  -- ---------------------------------------------------------------- workflow progress
  CREATE TABLE progress (
    id INTEGER PRIMARY KEY,
    photo_id INTEGER NOT NULL,
    step TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'done',
    at TEXT NOT NULL,
    UNIQUE (photo_id, step)
  );
  `
]

export const SCHEMA_VERSION = MIGRATIONS.length
