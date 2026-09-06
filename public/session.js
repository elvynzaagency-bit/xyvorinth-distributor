(function () {
  const SESSION_KEY = 'xyvorinth_browser_session';

  if (!sessionStorage.getItem(SESSION_KEY)) {
    sessionStorage.setItem(SESSION_KEY, Date.now().toString());
  }
})();
