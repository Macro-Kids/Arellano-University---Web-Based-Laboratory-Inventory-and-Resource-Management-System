// laboratories/repo.js — data access for Laboratory.
import { getDb } from '../../db/connection.js';

const SELECT = `
  SELECT l.laboratory_id AS id, l.name, l.type, l.location, l.description, l.status, l.created_at AS createdAt,
         (SELECT COUNT(*) FROM Inventory_Item i WHERE i.laboratory_id = l.laboratory_id AND i.status = 'Active') AS itemCount,
         (SELECT COUNT(*) FROM Asset a WHERE a.laboratory_id = l.laboratory_id AND a.status NOT IN ('Lost','Retired')) AS assetCount
  FROM Laboratory l`;
export const list = (ids) => ids
  ? getDb().prepare(`${SELECT} WHERE l.laboratory_id IN (${ids.map(() => '?').join(',') || 'NULL'}) ORDER BY l.name`).all(...ids)
  : getDb().prepare(`${SELECT} ORDER BY l.name`).all();
export const getById = (id) => getDb().prepare(`${SELECT} WHERE l.laboratory_id = ?`).get(id);
export const nameTaken = (name, exceptId = 0) => !!getDb().prepare('SELECT 1 FROM Laboratory WHERE name = ? COLLATE NOCASE AND laboratory_id <> ?').get(name, exceptId);
export const insert = (l) => getDb().prepare(`INSERT INTO Laboratory (name, type, location, description, status, created_at) VALUES (@name,@type,@location,@description,@status,@now)`).run(l).lastInsertRowid;
export const update = (id, l) => getDb().prepare(`UPDATE Laboratory SET name=@name, type=@type, location=@location, description=@description, status=@status WHERE laboratory_id=@id`).run({ ...l, id });
