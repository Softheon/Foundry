(ns metabase.util.export
  (:require [cheshire.core :as json]
            [metabase.csv.csv :as csv]
           ;; [dk.ative.docjure.spreadsheet :as spreadsheet]
            [clojure.java.io :as io]
            [ring.util.io :as ring-io]
            [clojure.tools.logging :as log]
            [metabase.util
             [xlsx :as excel]
             [i18n :refer [trs]]]
            [metabase.config :as config])
  (:import [java.io ByteArrayInputStream ByteArrayOutputStream File]
           (java.io PipedInputStream PipedOutputStream)
           (java.util.concurrent Executors ThreadPoolExecutor)
           org.apache.commons.lang3.concurrent.BasicThreadFactory$Builder
           org.apache.poi.ss.usermodel.Cell))

;; add a generic implementation for the method that writes values to XLSX cells that just piggybacks off the
;; implementations we've already defined for encoding things as JSON. These implementations live in
;; `metabase.middleware`.
;; (defmethod spreadsheet/set-cell! Object [^Cell cell, value]
;;   (when (= (.getCellType cell) Cell/CELL_TYPE_FORMULA)
;;     (.setCellType cell Cell/CELL_TYPE_STRING))
;;   ;; stick the object in a JSON map and encode it, which will force conversion to a string. Then unparse that JSON and
;;   ;; use the resulting value as the cell's new String value.  There might be some more efficient way of doing this but
;;   ;; I'm not sure what it is.
;;   (.setCellValue cell (str (-> (json/generate-string {:v value})
;;                                (json/parse-string keyword)
;;                                :v))))

(defmethod excel/set-cell! Object [^Cell cell, value]
  (.setCellValue cell (str (-> (json/generate-string {:v value})
                               (json/parse-string keyword)
                               :v))))

(defn- results->cells
  "Convert the resultset to a seq of rows with the first row as a header"
  [results]
  (cons (map :display_name (get-in results [:result :data :cols]))
        (get-in results [:result :data :rows])))

;; (defn- export-to-xlsx [columns rows]
;;   (let [wb  (spreadsheet/create-workbook "Query result" (cons (mapv name columns) rows))
;;         ;; note: byte array streams don't need to be closed
;;         out (ByteArrayOutputStream.)]
;;     (spreadsheet/save-workbook! out wb)
;;     (ByteArrayInputStream. (.toByteArray out))))

(defn export-to-xlsx-file
  "Write an XLS file to `FILE` with the header a and rows found in `RESULTS`"
  [^File file results]
  ;; (let [file-path (.getAbsolutePath file)]
  ;;   (->> (results->cells results)
  ;;        (spreadsheet/create-workbook "Query result")
  ;;        (spreadsheet/save-workbook! file-path)))
  )

(defn- export-to-csv [columns rows]
  (with-out-str
    ;; turn keywords into strings, otherwise we get colons in our output
    (csv/write-csv *out* (into [(mapv name columns)] rows))))

(defn export-to-csv-writer
  "Write a CSV to `FILE` with the header a and rows found in `RESULTS`"
  [^File file results]

  (with-open [fw (java.io.FileWriter. file)]
    (csv/write-csv fw (results->cells results))))

(defn- export-to-json [columns rows]
  (for [row rows]
    (zipmap columns row)))

; (defn stream-csv-format
;   [result]
;   (let [csv-stream-writer (fn [writer]
;                       (csv/write-csv writer result)
;                       (.flush writer))]
;     (ring-io/piped-input-stream #(csv-stream-writer (io/make-writer % {})))))

(defn csv-stream-writer
  [writer results]
  (let [out (io/make-writer writer {})]
    (try
      (csv/write-csv out results)
      (.flush out)
      (catch Exception e
        (throw e))
      (finally
        (.close out)))))

(def  ^:private ^Long thread-pool-max-size
  (or (config/config-int :mb-async-query-thread-pool-size)
      (config/config-int :mb-jetty-maxthreads)
      50))

(defonce ^:private thread-pool*
  (delay
   (Executors/newFixedThreadPool thread-pool-max-size
                                 (.build
                                  (doto (BasicThreadFactory$Builder.)
                                    (.namingPattern "download-streaming-response-thread-pool-%d")
                                    (.daemon true))))))

(defn thread-pool
  "Thread pool for asynchronously running streaming response."
  ^ThreadPoolExecutor []
  @thread-pool*)

(defn export-to-csv-stream
  [connection]
  (fn [data]
    (let [input (PipedInputStream.)
          output (PipedOutputStream.)
          task (bound-fn []
                 (try
                   (let [out (io/make-writer output {})]
                     (try
                       (csv/write-csv out data)
                       (finally
                         (.flush out))))
                   (finally
                     (.flush output)
                     (.close output)
                     (.close connection))))]
      (.connect input output)
      (.submit (thread-pool) ^Runnable task)
      input)))

(defn export-to-xlsx-stream
  [connection]
  (fn [data]
    (log/info "connection is")
    (log/info connection)
    (let [input (PipedInputStream.)
          output (PipedOutputStream.)
          task (bound-fn []
                 (try
                   (let [workbook (excel/create-workbook "Query Result" data)]
                     (try
                       (excel/save-workbook! output workbook)
                       (finally
                         (excel/dispose-workbook workbook))))
                   (catch Throwable e
                     (log/error e)
                     (log/error e (trs "Casught unexpected Exception during steaming response.")))
                   (finally
                     (.flush output)
                     (.close output)
                     (.close connection))))]
      (.connect input output)
      (.submit (thread-pool) ^Runnable task)
      input)))

(def export-formats
  "Map of export types to their relevant metadata"
  {"csv"  {:export-fn    export-to-csv-stream
           :content-type "text/csv"
           :ext          "csv"
           :context      :csv-download}
   "xlsx" {:export-fn    export-to-xlsx-stream
           :content-type "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
           :ext          "xlsx"
           :context      :xlsx-download}
  ;  "json" {:export-fn    export-to-json
  ;          :content-type "applicaton/json"
  ;          :ext          "json"
  ;          :context      :json-download}
   })

(defn- export-card-to-json
  [card]
  (assoc {}
         :id (:id card)
         :collection_id (:collection_id card)
         :visualization_settings (:visualization_settings card)
         :dataset_query (:dataset_query card)
         :description (:description card)
         :database_id (:database_id card)
         :display (:display card)
         :name (:name card)
         :collection_position (:collection_position card)))

(def card-export-formats
  "Map of card export types to their relevant metadata"
  {"json" {:export-fn export-card-to-json
           :content-type "application/json"
           :ext "json"
           :context ":json-download"}})
