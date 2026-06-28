export function getByPath(object, path) {
  if (!path) {
    return undefined;
  }

  return path.split('.').reduce((current, segment) => {
    if (current === undefined || current === null) {
      return undefined;
    }

    return current[segment];
  }, object);
}
