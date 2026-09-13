/** Synthetic native artifact record store with unique keys and optimistic locking.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
'use strict';
const TYPE = 'customrecord_pld_batch_artifact';
function installArtifactStore(stubs) {
  const rows = new Map(); let sequence = 7000;
  const previousRecord = stubs['N/record'] || {};
  const previousSearch = stubs['N/search'] || {};
  function recordView(id, initial, fresh) {
    const fields = { ...initial }; let baseline = fresh ? null : JSON.stringify(initial);
    return { id,
      getValue: ({ fieldId }) => fields[fieldId] ?? '',
      setValue: ({ fieldId, value }) => { fields[fieldId] = value; },
      save() {
        if (rows.beforeSave) rows.beforeSave({ id, fields, fresh: baseline === null });
        if (baseline !== null && JSON.stringify(rows.get(id)) !== baseline) {
          const error = new Error('Artifact changed concurrently'); error.name = 'RCRD_HAS_BEEN_CHANGED'; throw error;
        }
        for (const [otherId, other] of rows) {
          if (otherId !== id && String(other.externalid).toLowerCase() === String(fields.externalid).toLowerCase()) throw new Error('Native duplicate external ID');
        }
        rows.set(id, { ...fields }); baseline = JSON.stringify(fields);
        return id;
      },
    };
  }
  stubs['N/record'] = Object.assign({}, previousRecord, {
    create(opts) { return opts.type === TYPE ? recordView(String(++sequence), {}, true) : previousRecord.create(opts); },
    load(opts) {
      if (opts.type !== TYPE) return previousRecord.load(opts);
      const row = rows.get(String(opts.id));
      if (!row) throw new Error('Artifact record missing');
      return recordView(String(opts.id), row, false);
    },
  });
  function matches(row, filters) {
    return filters.every((term) => {
      if (term === 'AND') return true;
      const [field, operator, value] = term;
      if (operator !== 'is') throw new Error('Unsupported artifact fixture filter: ' + operator);
      return String(row[field === 'externalidstring' ? 'externalid' : field] ?? '') === String(value);
    });
  }
  stubs['N/search'] = Object.assign({}, previousSearch, {
    Sort: previousSearch.Sort || { ASC: 'ASC', DESC: 'DESC' },
    createColumn: previousSearch.createColumn || ((opts) => opts),
    create(opts) {
      if (opts.type !== TYPE) return previousSearch.create(opts);
      return { run: () => ({ getRange: ({ start, end }) => {
        const found = [...rows].filter(([, row]) => matches(row, opts.filters)).sort((a, b) => Number(a[1].custrecord_pld_art_ordinal) - Number(b[1].custrecord_pld_art_ordinal));
        return found.slice(start, end).map(([id, fields]) => ({ id, getValue: (opts) => fields[typeof opts === 'string' ? opts : opts.name] ?? '' }));
      } }) };
    },
  });
  return rows;
}
module.exports = { installArtifactStore };
