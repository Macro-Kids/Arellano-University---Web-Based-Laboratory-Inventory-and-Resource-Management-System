// categories/repo.js — data access for Category.
import { getDb } from '../../db/connection.js';
const SELECT = `SELECT c.category_id AS id, c.name, c.description, c.status,
                (SELECT COUNT(*) FROM Inventory_Item i WHERE i.category_id = c.category_id AND i.status='Active') AS itemCount FROM Category c`;
export const list = (onlyActive) => getDb().prepare(`${SELECT} ${onlyActive ? "WHERE c.status = 'Active'" : ''} ORDER BY c.name`).all();
export const getById = (id) => getDb().prepare(`${SELECT} WHERE c.category_id = ?`).get(id);
export const nameTaken = (name, exceptId = 0) => !!getDb().prepare('SELECT 1 FROM Category WHERE name = ? COLLATE NOCASE AND category_id <> ?').get(name, exceptId);
export const insert = (c) => getDb().prepare(`INSERT INTO Category (name, description, status) VALUES (@name,@description,@status)`).run(c).lastInsertRowid;
export const update = (id, c) => getDb().prepare(`UPDATE Category SET name=@name, description=@description, status=@status WHERE category_id=@id`).run({ ...c, id });
