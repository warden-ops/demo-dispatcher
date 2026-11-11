/**
 * Appels ouverts à répartir : tâche NOTSTART liée à un cas
 * Maintenance (6) ou Repair (7), hors Terminé / Annulé / Fermé.
 * La copie prod du sandbox porte externalId PROD-CASE- et PROD-TASK-.
 */
export const APPELS_SUITEQL = `
SELECT
  t.id AS task_id,
  s.id AS case_id,
  s.casenumber,
  s.custevent_nx_case_type AS case_type,
  BUILTIN.DF(s.status) AS case_status,
  BUILTIN.DF(s.company) AS site,
  s.company AS site_id,
  s.custevent_nx_customer AS customer_id,
  BUILTIN.DF(s.custevent_nx_customer) AS customer,
  s.custevent_nx_case_asset AS asset_id,
  BUILTIN.DF(s.custevent_nx_case_asset) AS asset,
  t.custevent_nx_address AS address,
  t.custevent_nx_latitude AS lat,
  t.custevent_nx_longitude AS lng,
  site_addr.city AS site_city,
  site_addr.state AS site_state,
  site_addr.zip AS site_zip,
  cust_addr.city AS customer_city,
  cust_addr.state AS customer_state,
  cust_addr.zip AS customer_zip,
  t.assigned AS tech_id,
  BUILTIN.DF(t.assigned) AS tech,
  TO_CHAR(t.startdate, 'YYYY-MM-DD') AS start_date,
  TO_CHAR(t.starttime, 'HH24:MI') AS start_time,
  t.status AS task_status,
  TO_CHAR(s.startdate, 'YYYY-MM-DD') AS opened_at,
  s.priority
FROM task t
JOIN supportcase s ON s.id = t.supportcase
LEFT JOIN customer site_customer ON site_customer.id = s.company
LEFT JOIN entityAddress site_addr ON site_addr.nkey = site_customer.defaultshippingaddress
LEFT JOIN customer cust_customer ON cust_customer.id = s.custevent_nx_customer
LEFT JOIN entityAddress cust_addr ON cust_addr.nkey = cust_customer.defaultshippingaddress
WHERE t.status = 'NOTSTART'
  AND s.custevent_nx_case_type IN (6, 7)
  AND s.status NOT IN (17, 19, 20)
  AND s.externalid LIKE 'PROD-CASE-%'
  AND t.externalid LIKE 'PROD-TASK-%'
ORDER BY t.startdate
`.trim();

/**
 * Même filtre, sans jointure d'adresse. Sert si le compte refuse
 * entityAddress ou defaultshippingaddress. La ville est alors lue dans le texte.
 */
export const APPELS_SUITEQL_TEXT = `
SELECT
  t.id AS task_id,
  s.id AS case_id,
  s.casenumber,
  s.custevent_nx_case_type AS case_type,
  BUILTIN.DF(s.status) AS case_status,
  BUILTIN.DF(s.company) AS site,
  s.company AS site_id,
  s.custevent_nx_customer AS customer_id,
  BUILTIN.DF(s.custevent_nx_customer) AS customer,
  s.custevent_nx_case_asset AS asset_id,
  BUILTIN.DF(s.custevent_nx_case_asset) AS asset,
  t.custevent_nx_address AS address,
  t.custevent_nx_latitude AS lat,
  t.custevent_nx_longitude AS lng,
  t.assigned AS tech_id,
  BUILTIN.DF(t.assigned) AS tech,
  TO_CHAR(t.startdate, 'YYYY-MM-DD') AS start_date,
  TO_CHAR(t.starttime, 'HH24:MI') AS start_time,
  t.status AS task_status,
  TO_CHAR(s.startdate, 'YYYY-MM-DD') AS opened_at,
  s.priority
FROM task t
JOIN supportcase s ON s.id = t.supportcase
WHERE t.status = 'NOTSTART'
  AND s.custevent_nx_case_type IN (6, 7)
  AND s.status NOT IN (17, 19, 20)
  AND s.externalid LIKE 'PROD-CASE-%'
  AND t.externalid LIKE 'PROD-TASK-%'
ORDER BY t.startdate
`.trim();

/**
 * Employés actifs. Le filtre de département se fait ensuite en code.
 * La zone vient du lieu et de l'adresse par défaut, avec la même dérivation
 * que les appels. Les requêtes de repli sont essayées si une colonne manque.
 */
export const TECHS_SUITEQL = `
SELECT
  e.id AS id,
  e.entityid AS entityid,
  e.firstname AS firstname,
  e.lastname AS lastname,
  BUILTIN.DF(e.department) AS department,
  BUILTIN.DF(e.location) AS location,
  emp_addr.city AS city,
  emp_addr.state AS state,
  emp_addr.zip AS zip
FROM employee e
LEFT JOIN entityAddress emp_addr ON emp_addr.nkey = e.defaultshippingaddress
WHERE e.isinactive = 'F'
ORDER BY e.lastname, e.firstname
`.trim();

export const TECHS_SUITEQL_LOCATION = `
SELECT
  e.id AS id,
  e.entityid AS entityid,
  e.firstname AS firstname,
  e.lastname AS lastname,
  BUILTIN.DF(e.department) AS department,
  BUILTIN.DF(e.location) AS location
FROM employee e
WHERE e.isinactive = 'F'
ORDER BY e.lastname, e.firstname
`.trim();

export const TECHS_SUITEQL_PLAIN = `
SELECT
  e.id AS id,
  e.entityid AS entityid,
  e.firstname AS firstname,
  e.lastname AS lastname,
  BUILTIN.DF(e.department) AS department
FROM employee e
WHERE e.isinactive = 'F'
ORDER BY e.lastname, e.firstname
`.trim();

export const CUSTOMERS_SUITEQL = `
SELECT
  c.id AS id,
  c.entityid AS entityid,
  c.companyname AS companyname,
  c.email AS email
FROM customer c
WHERE c.isinactive = 'F'
ORDER BY c.id
`.trim();

export const ITEMS_SUITEQL = `
SELECT
  i.id AS id,
  i.itemid AS itemid,
  i.displayname AS displayname,
  i.itemtype AS itemtype
FROM item i
WHERE i.isinactive = 'F'
ORDER BY i.id
`.trim();
