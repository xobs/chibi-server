package main

import (
    "fmt"
    "log"
    "flag"
    "net/http"
    "time"
    "os"
    "io/ioutil"
    "github.com/skratchdot/open-golang/open"
)

const initialTimerSecs = 60     /* Initial load is higher, in case browser needs to start */
const browserTimeoutSecs = 30   /* If no pings for 30 seconds, exit */
var shouldQuit = true           /* Set to false by "ping", set to "true" by timeout */

var port = flag.String("port", "5713", "Port number to listen on")
var host = flag.String("address", "127.0.0.1", "Address to bind to")
var root = flag.String("root", ".", "Root directory")
var filename = flag.String("file", "", "File to upload")
var file []byte

func pingHandler(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "Ping success");
    shouldQuit = false
}

func sendFile(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/octet-stream")
    w.Write(file)
}

func checkForQuit() {
    
    /* If nobody called /ping, quit the server. */
    if shouldQuit {
        log.Println("No requests recently, quitting.")
        os.Exit(0)
    }

    /* Re-queue a check. */
    shouldQuit = true
    time.AfterFunc(browserTimeoutSecs * time.Second, checkForQuit)
}

func main() {
    
    flag.Parse()
    tmpfile, ioerr := ioutil.ReadFile(*filename)
    if ioerr != nil {
        log.Fatal("Unable to load input file: ", ioerr)
        panic(ioerr)
    }
    file = tmpfile
    
    fmt.Println("Serving files in " + *root + " on port " + *port)
    http.Handle("/", http.FileServer(http.Dir(*root)))
    http.HandleFunc("/ping", pingHandler)
    http.HandleFunc("/file.bin", sendFile)
    
    /* Check for quit after the initialTimerSecs.  If nobody accesses /ping
     * before then, close the server.
     */
    time.AfterFunc(initialTimerSecs * time.Second, checkForQuit)
    
    /* May be racy! */
    open.Start("http://" + *host + ":" + *port + "/index.html")
    httperr := http.ListenAndServe(*host + ":" + *port, nil)
    if httperr != nil {
        log.Fatal("ListenAndServe: ", httperr)
    }
}
