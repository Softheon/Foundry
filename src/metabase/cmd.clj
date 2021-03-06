(ns metabase.cmd
  "Functions for commands that can be ran from the command-line with `lein` or the Foundry JAR. These are ran as
  follows:

    <metabase> <command> <options>

  for example, running the `migrate` command and passing it `force` can be done using one of the following ways:

    lein run migrate force
    java -jar metabase.jar migrate force


  Logic below translates resolves the command itself to a function marked with `^:command` metadata and calls the
  function with arguments as appropriate.

  You can see what commands are available by running the command `help`. This command uses the docstrings and arglists
  associated with each command's entrypoint function to generate descriptions for each command."
  (:require [clojure.string :as str]
            [metabase
             [config :as config]
             [db :as mdb]
             [util :as u]]
            [metabase.util.date :as du]))

(defn ^:command migrate
  "Run database migrations. Valid options for DIRECTION are `up`, `force`, `down-one`, `print`, or `release-locks`."
  [direction]
  (mdb/migrate! (keyword direction)))

(defn ^:command load-from-h2
  "Transfer data from existing H2 database to the newly created MySQL or Postgres DB specified by env vars."
  ([]
   (load-from-h2 nil))
  ([h2-connection-string]
   (require 'metabase.cmd.load-from-h2)
   (binding [mdb/*disable-data-migrations* true]
     ((resolve 'metabase.cmd.load-from-h2/load-from-h2!) h2-connection-string))))

(defn ^:command profile
  "Start Foundry the usual way and exit. Useful for profiling Foundry launch time."
  []
  ;; override env var that would normally make Jetty block forever
  (require 'environ.core)
  (intern 'environ.core 'env (assoc @(resolve 'environ.core/env) :mb-jetty-join "false"))
  (du/profile "start-normally" ((resolve 'metabase.core/start-normally))))

(defn ^:command reset-password
  "Reset the password for a user with EMAIL-ADDRESS."
  [email-address]
  (require 'metabase.cmd.reset-password)
  ((resolve 'metabase.cmd.reset-password/reset-password!) email-address))

(defn ^:command refresh-integration-test-db-metadata
  "Re-sync the frontend integration test DB's metadata for the Sample Dataset."
  []
  (require 'metabase.cmd.refresh-integration-test-db-metadata)
  ((resolve 'metabase.cmd.refresh-integration-test-db-metadata/refresh-integration-test-db-metadata)))

(defn ^:command help
  "Show this help message listing valid Foundry commands."
  []
  (println "Valid commands are:")
  (doseq [[symb varr] (sort (ns-interns 'metabase.cmd))
          :when       (:command (meta varr))]
    (println symb (str/join " " (:arglists (meta varr))))
    (println "\t" (when-let [dox (:doc (meta varr))]
                    (str/replace dox #"\s+" " ")))) ; replace newlines or multiple spaces with single spaces
  (println "\nSome other commands you might find useful:\n")
  (println "java -cp metabase.jar org.h2.tools.Shell -url jdbc:h2:/path/to/metabase.db")
  (println "\tOpen an SQL shell for the Foundry H2 DB"))

(defn ^:command version
  "Print version information about Foundry and the current system."
  []
  (println "Foundry version:" config/mb-version-info)
  (println "\nOS:"
           (System/getProperty "os.name")
           (System/getProperty "os.version")
           (System/getProperty "os.arch"))
  (println "\nJava version:"
           (System/getProperty "java.vm.name")
           (System/getProperty "java.version"))
  (println "\nCountry:"       (System/getProperty "user.country"))
  (println "System timezone:" (System/getProperty "user.timezone"))
  (println "Language:"        (System/getProperty "user.language"))
  (println "File encoding:"   (System/getProperty "file.encoding")))

(defn ^:command api-documentation
  "Generate a markdown file containing documentation for all API endpoints. This is written to a file called
  `docs/api-documentation.md`."
  []
  (require 'metabase.cmd.endpoint-dox)
  ((resolve 'metabase.cmd.endpoint-dox/generate-dox!)))

(defn ^:command check-i18n
  "Run normally, but with fake translations in place for all user-facing backend strings. Useful for checking what
  things need to be wrapped with i18n forms."
  []
  (println "Swapping out implementation of puppetlabs.i18n.core/fmt...")
  (require 'puppetlabs.i18n.core)
  (let [orig-fn @(resolve 'puppetlabs.i18n.core/fmt)]
    (intern 'puppetlabs.i18n.core 'fmt (comp str/reverse orig-fn)))
  (println "Ok.")
  (println "Reloading all Foundry namespaces...")
  (let [namespaces-to-reload (for [ns-symb @u/metabase-namespace-symbols
                                   :when (and (not (#{'metabase.cmd 'metabase.core} ns-symb))
                                              (u/ignore-exceptions
                                                ;; try to resolve namespace. If it's not loaded yet, this will throw
                                                ;; an Exception, so we can skip reloading it
                                                (the-ns ns-symb)))]
                               ns-symb)]
    (apply require (conj (vec namespaces-to-reload) :reload)))
  (println "Ok.")
  (println "Starting normally with swapped i18n strings...")
  ((resolve 'metabase.core/start-normally)))


;;; ------------------------------------------------ Running Commands ------------------------------------------------

(defn- cmd->fn [command-name]
  (or (when (seq command-name)
        (when-let [varr (ns-resolve 'metabase.cmd (symbol command-name))]
          (when (:command (meta varr))
            @varr)))
      (do (println (u/format-color 'red "Unrecognized command: %s" command-name))
          (help)
          (System/exit 1))))

(defn run-cmd
  "Run `cmd` with `args`. This is a function above. e.g. `lein run metabase migrate force` becomes
  `(migrate \"force\")`."
  [cmd args]
  (try (apply (cmd->fn cmd) args)
       (catch Throwable e
         (.printStackTrace e)
         (println (u/format-color 'red "Command failed with exception: %s" (.getMessage e)))
         (System/exit 1)))
  (System/exit 0))
