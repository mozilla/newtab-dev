/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

function runTests() {
  yield setLinks("0,1,2,3,4,5,6,7,8");
  setPinnedLinks("");
  yield whenPagesUpdated();

  yield addNewTabPageTab();
  checkGrid("0,1,2,3,4,5,6,7,8");

  yield simulateExternalDrop(1);
  checkGrid("0,99p,1,2,3,4,5,6,7");

  yield blockCell(1);
  checkGrid("0,1,2,3,4,5,6,7,8");

  yield simulateExternalDrop(1);
  checkGrid("0,99p,1,2,3,4,5,6,7");

  // Simulate a restart and force the next about:newtab
  // instance to read its data from the storage again.
  NewTabUtils.blockedLinks.resetCache();

  // Update all open pages, e.g. preloaded ones.
  AboutNewTab.updateTest(gWindow.gBrowser);

  yield addNewTabPageTab();
  checkGrid("0,99p,1,2,3,4,5,6,7");

  yield blockCell(1);
  yield whenPagesUpdated();
  checkGrid("0,1,2,3,4,5,6,7,8");
}
