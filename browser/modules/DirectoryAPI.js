/*global Directory*/
'use strict';
document.getElementById('dropDiv').addEventListener('drop', function (e) {
  e.stopPropagation();
  e.preventDefault();

  function uploadFile(file) {
    // handle file uploading
  }

  function toPromises(item){
    if (item instanceof Directory){
      return item.getFilesAndDirectories()
        .then(reduceToFiles);
    }
    return Promise.resolve(item);
  }

  function reduceToFiles(filesAndDirs) {
    const getFilesPromises = filesAndDirs.map(toPromises);
    return Promise.all(getFilesPromises)
      .then(
        results => results.reduce((list, next) => list.concat(...next), [])
      );
  }
  // begin by traversing the chosen files and directories
  reduceToFiles([e.dataTransfer])
    .then(
      files => Promise.all(
          files.map(file => uploadFile(file))
        ).then(
          files =>
        )
    )
    .catch(
      err => console.log(err)
    );
});
