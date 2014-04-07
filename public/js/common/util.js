function guid() {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000)
               .toString(16)
               .substring(1);
  }
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
         s4() + '-' + s4() + s4() + s4();
}

function compare (a, b) {
	var result = true;
	for (var key in a) {
		result &= a[key] == b[key] ? true : false;
	}
	return result;
}