/** Mask comments and quoted text in lexical order for local SQL heuristics.
 * This is not a SQL parser or an authorization boundary.
 */
export const stripSqlCommentsAndStrings = (sql: string): string => {
  const tokens = /--[^\r\n]*|\/\*|'|"/g;
  const parts: string[] = [];
  let copied = 0;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(sql)) !== null) {
    parts.push(sql.slice(copied, match.index));
    const token = match[0];
    let end = tokens.lastIndex;
    if (token === "/*") {
      const boundaries = /\/\*|\*\//g;
      boundaries.lastIndex = end;
      let depth = 1;
      let boundary: RegExpExecArray | null;
      while (depth > 0 && (boundary = boundaries.exec(sql)) !== null) {
        depth += boundary[0] === "/*" ? 1 : -1;
        end = boundaries.lastIndex;
      }
      if (depth > 0) end = sql.length;
    } else if (token === "'" || token === '"') {
      for (;;) {
        const quote = sql.indexOf(token, end);
        if (quote < 0) {
          end = sql.length;
          break;
        }
        end = quote + 1;
        if (sql[end] !== token) break;
        end++;
      }
    }
    // Comments separate tokens; removing them would turn DELETE/**/FROM into DELETEFROM.
    parts.push(token === "'" || token === '"' ? token + token : " ");
    copied = end;
    tokens.lastIndex = end;
  }
  if (copied === 0) return sql;
  parts.push(sql.slice(copied));
  return parts.join("");
};
