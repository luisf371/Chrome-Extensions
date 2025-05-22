-v4-
fixed 2 bugs
a) gesture displayed incorrectly due to being displayed based on page cords rather than client.
b) gesture scripts load once page is "idle" to prevent issues on loading at "start"

-v3-
renamed to sGesture
fixed async errors
modified options.html - added tooltip - minor layout changes

-v2-
updated background.js from deepseek recommendation
a)Promises: Transitioned from callback-based APIs to promise-based APIs using async and await.
b)Error Handling: Added try-catch blocks around asynchronous operations to handle errors gracefully.
c)Code Readability: Improved readability by breaking down complex operations into smaller, more focused blocks.
updated mousetrack.js in attempt to fix trail colors
a)Color Setting: Ensured that the ctx.strokeStyle is set to myColor in the draw function.
b)Initialization: Ensured that myColor is correctly set in the loadOptions function.
fixed trail color feature
-known issues-
a)errors Extension context invalidated. 
mouseTrack.js:135 (exeFunc)
mouseTrack.js:112 (anonymous function)
b)Error in sendChromeMessage: The message port closed before a response was received.
mouseTrack.js:195 (anonymous function)
color selection is not properly recalled when opening options tab

-v1-
working gestures
updated options page
fixed trails not showing after first occurance
updated code to manifest v3 compliance
removed deprecated code
removed all donation reference
-known issues-
rocker not working
gesture colors not working
